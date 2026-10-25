// Inventory-hold expiry for unpaid PayPal orders.
//
// WHY: a PayPal order reserves stock the moment it is created (the shopper's
// hold). If the shopper abandons the PayPal window, nothing ever released that
// hold — the item stayed "sold" forever. This service releases holds whose
// configured TTL has passed, exactly once, using the same atomic
// `stockReserved` claim the admin-cancel path uses (so the two can never
// double-restore).
//
// Money safety: an expired order keeps its `paypalOrderId`. If the shopper
// pays *after* expiry, the webhook finds the cancelled order and must NOT
// silently flip it back to 'completed' (stock was already returned) — see the
// `Cancelled` guard in orderController.processCaptureCompletedEvent, which
// raises an ops alert instead.
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { redactError } from '../utils/redact.js';

export const DEFAULT_RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
 * Return reserved units to the catalog. Shared by the expiry sweep and the
 * refund path so both restore inventory the same way (guarded, per-item,
 * non-fatal on failure).
 */
export async function restoreReservedStock(items) {
  for (const item of items) {
    if (!OBJECT_ID_RE.test(String(item.productId))) continue;
    try {
      await productModel.updateOne(
        { _id: item.productId },
        [{ $set: { stockQuantity: { $add: ['$stockQuantity', item.quantity] }, inStock: true } }]
      );
    } catch (error) {
      // Bookkeeping must never abort the sweep: the release stays claimed and
      // the failure is logged (redacted) for manual stock reconciliation.
      console.error('Reservation release: stock restore failed:', redactError(error));
    }
  }
}

/**
 * Release every reservation that expired before `now`.
 * Returns the ids of the orders it cancelled (empty array when none).
 *
 * Idempotent: the per-order `stockReserved: true` claim means a second run —
 * or a concurrent sweep — restores nothing.
 */
export async function releaseExpiredReservations({ now = new Date(), limit = 100 } = {}) {
  const expired = await orderModel
    .find({
      stockReserved: true,
      paymentStatus: 'pending',
      paymentMethod: 'PayPal',
      reservationExpiresAt: { $ne: null, $lte: now },
    })
    .select('_id items')
    .limit(limit)
    .lean();

  const released = [];

  for (const candidate of expired) {
    const claimed = await orderModel.findOneAndUpdate(
      { _id: candidate._id, stockReserved: true },
      {
        $set: {
          stockReserved: false,
          orderStatus: 'Cancelled',
          paymentStatus: 'failed',
        },
      },
      { new: true }
    );

    // Lost the race to another sweep/cancel: do not restore stock again.
    if (!claimed) continue;

    await restoreReservedStock(claimed.items);
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
      await releaseExpiredReservations();
    } catch (error) {
      logger.error('Reservation sweep failed:', redactError(error));
    }
  };

  const timer = setInterval(sweep, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return () => clearInterval(timer);
}

export default { releaseExpiredReservations, startReservationSweeper, getReservationTtlMs };
