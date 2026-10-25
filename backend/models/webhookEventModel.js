import mongoose from 'mongoose';

// Processed PayPal webhook events — Phase 1 work area 2 + final gate Tasks 1/6.
//
// Recoverable idempotency state machine (status field):
//   processing — acquisition succeeded; the order update is in flight
//   completed  — the event was fully processed; duplicates are acknowledged
//   failed     — processing threw; a later delivery re-acquires and retries
//   unresolved — a verified capture could NOT be safely applied yet (no
//                matching order, or amount/currency/identity verification
//                failed); a later delivery re-acquires and retries within a
//                bounded budget, after which it alerts for manual review
//
// The unique index on `eventId` makes acquisition atomic: insert (or a
// conditional findOneAndUpdate for re-acquisition) decides who processes the
// event, and a duplicate is acknowledged ONLY when status === 'completed'.
// Records written by the pre-state-machine code have no `status` field and
// are treated as recoverable (safe: the order update is idempotent).
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    resourceId: {
      type: String,
    },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed', 'unresolved'],
      default: 'processing',
    },
    attempts: {
      type: Number,
      default: 1,
      min: 1,
    },
    // Redacted, length-bounded processing error for the LAST failed attempt.
    lastError: {
      type: String,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    // 'order_updated' | 'order_updated_reconciled' | 'no_matching_order' |
    // 'no_matching_order_retry_exhausted' | 'amount_currency_mismatch' |
    // 'capture_order_mismatch' | 'ignored_event_type'
    result: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true, collection: 'webhookevents' }
);

const webhookEventModel =
  mongoose.models.webhookEvent || mongoose.model('webhookEvent', webhookEventSchema);

export default webhookEventModel;
