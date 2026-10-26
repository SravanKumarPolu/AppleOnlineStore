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
// Per item, `items[].stockRestored` is the exactly-once marker: an item is
// marked only AFTER its product credit succeeds, so a failed credit is retried
// while an already-credited item is never credited twice.
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
      const result = await productModel.updateOne(
        { _id: item.productId },
        [{ $set: { stockQuantity: { $add: ['$stockQuantity', item.quantity] }, inStock: true } }]
      );
      // matchedCount === 0 → the product was deleted; nothing to return.
      await markItemRestored(order._id, index);
      if (result.matchedCount === 0) {
        console.warn(
          `Reservation release: product ${item.productId} no longer exists (order ${order._id})`
        );
      }
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

/** One full inventory sweep: expired holds first, then owed restorations. */
export async function runInventorySweep(options = {}) {
  const released = await releaseExpiredReservations(options);
  const restorations = await retryPendingRestorations(options);
  return { released, restorations };
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
  runInventorySweep,
  releaseOrderReservation,
  restoreOrderInventory,
  claimReservationRelease,
  startReservationSweeper,
  getReservationTtlMs,
};
