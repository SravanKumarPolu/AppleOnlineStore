// Inventory-hold expiry and DURABLE stock restoration.
//
// WHY: a PayPal order reserves stock the moment it is created (the shopper's
// hold). If the shopper abandons the PayPal window, nothing ever released that
// hold — the item stayed "sold" forever. This service releases holds whose
// configured TTL has passed, exactly once, using the same atomic
// `stockReserved` claim the admin-cancel and refund paths use (so the three
// can never double-restore).
//
// DURABILITY (why the state machine exists): the original implementation
// cleared `stockReserved` and then credited each product back on a best-effort
// basis, swallowing per-product failures. A single failed `updateOne` (or a
// crash between the claim and the credit) left the order looking settled while
// the units were never returned — a permanent, silent inventory loss with no
// retry path. Restoration is now an explicit, retryable obligation:
//
//   inventoryRestoration.status
//     'none'                    — nothing was ever released (legacy/default)
//     'pending'                 — release claimed, units not all returned yet
//     'completed'               — every item's units are back in the catalog
//     'reconciliation_required' — at least one item failed and is retried on
//                                 every sweep; loud ops alert until resolved
//
// Per item, `items[].stockRestored` is bookkeeping; the EXACTLY-ONCE guarantee
// lives on the product: `restorationCredits[]` records `<orderId>:<itemIndex>`
// inside the SAME atomic findOneAndUpdate that increments `stockQuantity`.
// A crash between "stock incremented" and "marker written" is therefore
// harmless: the retry finds the credit id already in the ledger and skips the
// increment — the stock update and its durable proof cannot disagree.
//
// Money safety: an expired order keeps its `paypalOrderId`. If the shopper
// pays *after* expiry, the webhook finds the cancelled order and must NOT
// silently flip it back to 'completed' (stock was already returned) — see the
// `Cancelled` guard in orderController.processCaptureCompletedEvent and the
// capture endpoint's equivalent guard, which raise an ops alert instead.
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { redactError } from '../utils/redact.js';

export const DEFAULT_RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// How long an UNCOMMITTED order draft may exist before the sweep treats it as
// abandoned (K-21). A normal reservation takes milliseconds; this only guards
// against a request that died between its first debit and the commit.
export const ABANDONED_RESERVATION_MS = 2 * 60 * 1000; // 2 minutes

export const RESTORATION_STATUSES = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  COMPLETED: 'completed',
  RECONCILIATION_REQUIRED: 'reconciliation_required',
});

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** TTL for a PayPal stock hold, in ms (positive integer, env-configurable). */
export function getReservationTtlMs(env = process.env) {
  const parsed = Number(env.PAYPAL_RESERVATION_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_RESERVATION_TTL_MS;
}

/** Timestamp a freshly created PayPal order's hold expires at. */
export function reservationExpiryFrom(now = new Date(), env = process.env) {
  return new Date(now.getTime() + getReservationTtlMs(env));
}

/**
 * Structured, grep-friendly ops alert for inventory that is still not back in
 * the catalog. Log pipelines should route this to an on-call queue: it means a
 * customer's returned units are (temporarily) missing from sellable stock.
 */
function alertUnresolvedRestoration(orderId, failures) {
  console.error(
    `🚨 INVENTORY RESTORATION ALERT [unresolved_stock_restoration] ${JSON.stringify({
      orderId: String(orderId),
      failedItems: failures.length,
      productIds: failures.map((failure) => failure.productId),
    })}`
  );
}

/**
 * Atomically claim the obligation to release an order's hold.
 *
 * Returns the order document when this caller won the claim, or null when
 * another path (cancel / refund / expiry sweep) already owns it. The claim
 * marks restoration `pending` in the SAME write that clears `stockReserved`,
 * so a crash immediately after the claim is still recoverable by the sweep.
 */
export async function claimReservationRelease(orderId, { cancelOrder = false } = {}) {
  const release = {
    stockReserved: false,
    'inventoryRestoration.status': RESTORATION_STATUSES.PENDING,
    'inventoryRestoration.startedAt': new Date(),
    'inventoryRestoration.completedAt': null,
  };

  // Expiry and admin cancellation must leave a coherent order even if the
  // product credit fails afterwards: the order is cancelled in the SAME atomic
  // write that claims the release, so it can never sit in `pending` forever.
  if (cancelOrder) {
    release.orderStatus = 'Cancelled';
    release.paymentStatus = 'failed';
  }

  return orderModel.findOneAndUpdate(
    { _id: orderId, stockReserved: true },
    { $set: release },
    { new: true }
  );
}

/** Mark one item's units as returned. Index-stable: items[] is never reordered. */
async function markItemRestored(orderId, index) {
  await orderModel.updateOne(
    { _id: orderId },
    { $set: { [`items.${index}.stockRestored`]: true } }
  );
}

/**
 * Deterministic per-line restoration identity: the same order line always
 * maps to the same ledger entry, so any retry path converges on one credit.
 */
export function restorationCreditId(orderId, itemIndex) {
  return `${String(orderId)}:${itemIndex}`;
}

/**
 * Debit identity for one order line (K-21). The SAME id is written as the
 * product's `reservationDebits` marker when the units are taken and as the
 * `restorationCredits` entry when they are returned, so the two ledgers can
 * never disagree about a line.
 */
export function reservationDebitId(orderId, itemIndex) {
  return restorationCreditId(orderId, itemIndex);
}

/**
 * Commit a finished reservation: the draft becomes the owner of the hold.
 *
 * Returns null when the draft is no longer `pending` — in practice only when an
 * abandonment sweep already released it because the request stalled past
 * `ABANDONED_RESERVATION_MS`. The caller must then NOT report the order as
 * placed (the units are already back in the catalog).
 */
export async function commitStockReservation(orderId, { now = new Date() } = {}) {
  return orderModel.findOneAndUpdate(
    { _id: orderId, stockReserved: false, 'stockReservation.status': 'pending' },
    {
      $set: {
        stockReserved: true,
        'stockReservation.status': 'reserved',
        'stockReservation.completedAt': now,
      },
    },
    { new: true }
  );
}

/**
 * Credit back ONE line of an uncommitted draft.
 *
 * `reservationDebits: debitId` in the filter is the atomic proof that this line
 * was actually debited: if the marker is absent, no units were taken (or this
 * call already returned them), so the line is settled without guessing. The
 * credit and its `restorationCredits` proof are one update on one document, so a
 * crash or a concurrent retry can neither lose nor duplicate the credit.
 */
export async function creditReservedLine(productId, quantity, debitId) {
  if (!OBJECT_ID_RE.test(String(productId))) return { settled: true };

  const credited = await productModel.findOneAndUpdate(
    { _id: productId, reservationDebits: debitId, restorationCredits: { $ne: debitId } },
    {
      $inc: { stockQuantity: quantity },
      $addToSet: { restorationCredits: debitId },
      $pull: { reservationDebits: debitId },
      $set: { inStock: true },
    },
    { new: true }
  );

  if (credited) return { applied: true };

  // Marker gone: either it was never written (crash before this line) or a
  // earlier attempt already returned the units. Both are settled. A deleted
  // product has nothing to credit either.
  const productExists = await productModel.exists({ _id: productId });
  return productExists ? { settled: true } : { missing: true };
}

/**
 * Settle ONE abandoned reservation draft: credit exactly the marked lines back
 * and delete the draft. Idempotent and safe to run concurrently — the status
 * claim only decides who logs, not whether a line is credited.
 *
 * Returns { claimed: false } when the draft is not an abandoned reservation
 * (committed, already removed, or still inside its grace window).
 */
export async function releaseAbandonedReservation(
  orderId,
  { now = new Date(), olderThan = ABANDONED_RESERVATION_MS } = {}
) {
  const cutoff = new Date(now.getTime() - olderThan);
  const uncommitted = { $in: ['pending', 'releasing', 'failed'] };

  const claimed = await orderModel.findOneAndUpdate(
    {
      _id: orderId,
      stockReserved: false,
      'stockReservation.status': uncommitted,
      // A 'failed' draft is retried immediately; a fresh 'pending' one only
      // after the grace window (it may belong to a live request).
      $or: [
        { 'stockReservation.status': { $in: ['releasing', 'failed'] } },
        { 'stockReservation.startedAt': { $lte: cutoff } },
      ],
    },
    {
      $set: { 'stockReservation.status': 'releasing' },
      $inc: { 'stockReservation.attempts': 1 },
    },
    { new: true }
  );

  if (!claimed) return { claimed: false };

  const items = Array.isArray(claimed.items) ? claimed.items : [];
  const failures = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    try {
      await creditReservedLine(
        item.productId,
        item.quantity,
        reservationDebitId(claimed._id, index)
      );
    } catch (error) {
      failures.push({
        index,
        productId: String(item.productId),
        error: redactError(error).slice(0, 200),
      });
    }
  }

  if (failures.length === 0) {
    // No confirmation was ever returned to the shopper for this draft, so it
    // must not survive as an order. Guard on `stockReserved:false` so a
    // concurrent commit can never be deleted.
    await orderModel.deleteOne({ _id: claimed._id, stockReserved: false });
    return { claimed: true, released: true, failures };
  }

  const lastError = failures
    .map((failure) => `${failure.productId}: ${failure.error}`)
    .join('; ');
  await orderModel.updateOne(
    { _id: claimed._id },
    {
      $set: {
        'stockReservation.status': 'failed',
        'stockReservation.lastError': lastError.slice(0, 500),
      },
    }
  );
  console.error(
    `🚨 INVENTORY RESERVATION ALERT [unresolved_draft_release] ${JSON.stringify({
      orderId: String(claimed._id),
      failedItems: failures.length,
      productIds: failures.map((failure) => failure.productId),
    })}`
  );
  return { claimed: true, released: false, failures };
}

/**
 * Settle every abandoned reservation draft. This is the creation-time twin of
 * `retryPendingRestorations`: it closes the window where a process died after
 * debiting stock but before the order was committed (§16.4.1 / K-21).
 */
export async function releaseAbandonedReservations({
  now = new Date(),
  olderThan = ABANDONED_RESERVATION_MS,
  limit = 100,
} = {}) {
  const cutoff = new Date(now.getTime() - olderThan);
  const candidates = await orderModel
    .find({
      stockReserved: false,
      'stockReservation.status': { $in: ['pending', 'releasing', 'failed'] },
      $or: [
        { 'stockReservation.status': { $in: ['releasing', 'failed'] } },
        { 'stockReservation.startedAt': { $lte: cutoff } },
      ],
    })
    .select('_id')
    .limit(limit)
    .lean();

  const released = [];
  for (const candidate of candidates) {
    const result = await releaseAbandonedReservation(candidate._id, { now, olderThan });
    if (result.claimed) released.push(String(candidate._id));
  }

  if (released.length > 0) {
    console.warn(
      `♻️  Reconciled ${released.length} abandoned stock reservation(s): ${released.join(', ')}`
    );
  }

  return released;
}

/**
 * Credit one order line back to the catalog — ATOMICALLY with its proof.
 *
 * The stock increment and the ledger write are a single updateOne on ONE
 * product document, which MongoDB executes atomically (no replica set or
 * multi-document transaction required). The `$ne: creditId` filter means a
 * retry or a concurrent worker with the same credit id matches nothing and
 * cannot double-apply.
 *
 * Returns { applied: true } when this call credited the stock,
 *         { alreadyApplied: true } when the ledger proves it was done before,
 *         { missing: true } when the product no longer exists.
 */
export async function creditProductStock(productId, quantity, creditId) {
  const credited = await productModel.findOneAndUpdate(
    { _id: productId, restorationCredits: { $ne: creditId } },
    {
      $inc: { stockQuantity: quantity },
      $addToSet: { restorationCredits: creditId },
      // Same id: retire the creation-time debit marker with the credit, so the
      // product never accumulates markers for lines that are already returned.
      $pull: { reservationDebits: creditId },
      $set: { inStock: true },
    },
    { new: true }
  );

  if (credited) return { applied: true };

  // No match: either the credit was already applied, or the product is gone.
  const alreadyApplied = await productModel.exists({
    _id: productId,
    restorationCredits: creditId,
  });
  return alreadyApplied ? { alreadyApplied: true } : { missing: true };
}

/**
 * Credit every not-yet-restored item back to the catalog, then persist the
 * aggregate state. Idempotent per item, retryable per failure.
 *
 * Returns { status, failures } where status is a RESTORATION_STATUSES value.
 */
export async function restoreOrderInventory(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const failures = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.stockRestored) continue;

    // Deleted products and malformed ids have nothing to restore. Marking them
    // settled keeps the retry loop focused on real, recoverable failures.
    if (!OBJECT_ID_RE.test(String(item.productId))) {
      await markItemRestored(order._id, index);
      continue;
    }

    try {
      const result = await creditProductStock(
        item.productId,
        item.quantity,
        restorationCreditId(order._id, index)
      );
      if (result.missing) {
        console.warn(
          `Reservation release: product ${item.productId} no longer exists (order ${order._id})`
        );
      }
      // Bookkeeping AFTER the (idempotent) credit. A crash here is safe: the
      // ledger already proves the credit, so the retry will not increment again.
      await markItemRestored(order._id, index);
    } catch (error) {
      failures.push({
        index,
        productId: String(item.productId),
        error: redactError(error).slice(0, 200),
      });
    }
  }

  const now = new Date();
  if (failures.length === 0) {
    await orderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          'inventoryRestoration.status': RESTORATION_STATUSES.COMPLETED,
          'inventoryRestoration.completedAt': now,
          'inventoryRestoration.lastError': null,
        },
        $inc: { 'inventoryRestoration.attempts': 1 },
      }
    );
    return { status: RESTORATION_STATUSES.COMPLETED, failures };
  }

  const lastError = failures.map((failure) => `${failure.productId}: ${failure.error}`).join('; ');
  await orderModel.updateOne(
    { _id: order._id },
    {
      $set: {
        'inventoryRestoration.status': RESTORATION_STATUSES.RECONCILIATION_REQUIRED,
        'inventoryRestoration.lastError': lastError.slice(0, 500),
      },
      $inc: { 'inventoryRestoration.attempts': 1 },
    }
  );
  alertUnresolvedRestoration(order._id, failures);
  return { status: RESTORATION_STATUSES.RECONCILIATION_REQUIRED, failures };
}

/**
 * Claim and restore in one call — the entry point shared by admin cancel,
 * refunds and the expiry sweep.
 *
 * Returns { claimed: false } when another path already released the hold,
 * otherwise { claimed: true, status, failures }.
 */
export async function releaseOrderReservation(orderId, options = {}) {
  const claimed = await claimReservationRelease(orderId, options);
  if (!claimed) return { claimed: false };
  const { status, failures } = await restoreOrderInventory(claimed);
  return { claimed: true, status, failures };
}

/**
 * Release every reservation that expired before `now`.
 * Returns the ids of the orders it cancelled (empty array when none).
 *
 * Idempotent: the per-order `stockReserved` claim means a second run — or a
 * concurrent sweep — restores nothing.
 */
export async function releaseExpiredReservations({ now = new Date(), limit = 100 } = {}) {
  const expired = await orderModel
    .find({
      stockReserved: true,
      paymentStatus: 'pending',
      paymentMethod: 'PayPal',
      reservationExpiresAt: { $ne: null, $lte: now },
    })
    .select('_id')
    .limit(limit)
    .lean();

  const released = [];

  for (const candidate of expired) {
    const claimed = await claimReservationRelease(candidate._id, { cancelOrder: true });
    // Lost the race to another sweep/cancel/refund: do not restore stock again.
    if (!claimed) continue;

    await restoreOrderInventory(claimed);
    released.push(String(claimed._id));
  }

  if (released.length > 0) {
    console.warn(
      `⏱️  Released ${released.length} expired PayPal reservation(s): ${released.join(', ')}`
    );
  }

  return released;
}

/**
 * Retry every restoration that is still owed (failed credit, or a crash
 * between the claim and the credit). Safe to run concurrently: each item is
 * guarded by its own `stockRestored` marker.
 *
 * Returns { retried, completed, unresolved }.
 */
export async function retryPendingRestorations({ limit = 100 } = {}) {
  const pending = await orderModel
    .find({
      stockReserved: false,
      'inventoryRestoration.status': {
        $in: [RESTORATION_STATUSES.PENDING, RESTORATION_STATUSES.RECONCILIATION_REQUIRED],
      },
    })
    .limit(limit)
    .lean();

  let completed = 0;
  let unresolved = 0;

  for (const order of pending) {
    const { status } = await restoreOrderInventory(order);
    if (status === RESTORATION_STATUSES.COMPLETED) completed += 1;
    else unresolved += 1;
  }

  if (unresolved > 0) {
    console.error(
      `🚨 INVENTORY RESTORATION ALERT [sweep_unresolved] ${JSON.stringify({
        unresolved,
        retried: pending.length,
      })}`
    );
  }

  return { retried: pending.length, completed, unresolved };
}

/** One full inventory sweep: expired holds, owed restorations, abandoned drafts. */
export async function runInventorySweep(options = {}) {
  const released = await releaseExpiredReservations(options);
  const restorations = await retryPendingRestorations(options);
  const abandoned = await releaseAbandonedReservations(options);
  return { released, restorations, abandoned };
}

/**
 * Run the sweep on an interval. Returns a stop function.
 * `unref()` keeps the timer from holding the process open (so tests and
 * graceful shutdown do not wait for it).
 */
export function startReservationSweeper({
  intervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  logger = console,
} = {}) {
  const sweep = async () => {
    try {
      await runInventorySweep();
    } catch (error) {
      logger.error('Reservation sweep failed:', redactError(error));
    }
  };

  const timer = setInterval(sweep, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return () => clearInterval(timer);
}

export default {
  releaseExpiredReservations,
  retryPendingRestorations,
  releaseAbandonedReservations,
  releaseAbandonedReservation,
  runInventorySweep,
  releaseOrderReservation,
  restoreOrderInventory,
  claimReservationRelease,
  commitStockReservation,
  creditProductStock,
  creditReservedLine,
  restorationCreditId,
  reservationDebitId,
  startReservationSweeper,
  getReservationTtlMs,
};
