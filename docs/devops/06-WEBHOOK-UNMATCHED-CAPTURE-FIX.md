# 06 — Webhook Unmatched-Capture Fix (Final Gate Task 6)

## Finding

`handlePayPalWebhook` (backend/controllers/orderController.js) processed a
signature-verified `PAYMENT.CAPTURE.COMPLETED` event by looking up an order
via `paypalCaptureId`. When no order matched, it recorded
`result: 'no_matching_order'`, marked the event **`status: 'completed'`** and
acknowledged the delivery with HTTP 200. PayPal stops retrying an
acknowledged webhook, so if the order row appeared later (delayed order
creation, or the webhook racing the capture endpoint's DB write), the order
kept `paymentStatus: 'pending'` forever — paid at PayPal, unpaid in NovaCart.

## Fix

### 1. Unmatched captures are no longer acknowledged as complete

- New event status **`unresolved`** (`webhookEventModel`), re-acquirable by
  later deliveries (added to the acquisition filter).
- Unmatched capture → `status: 'unresolved'`, `result: 'no_matching_order'`,
  **HTTP 500** so PayPal redelivers.

### 2. Bounded retry policy + alerting

- `WEBHOOK_MAX_UNMATCHED_ATTEMPTS` (default 10) bounds the retry budget.
  Attempt counts come from the existing `attempts` counter (incremented on
  every re-acquisition).
- Once the budget is spent, the delivery is acknowledged (HTTP 200) with the
  terminal result `no_matching_order_retry_exhausted`, and a structured
  `🚨 PAYMENT WEBHOOK ALERT [no_matching_order_retry_exhausted] {...}` line is
  logged for ops/manual reconciliation. PayPal itself retries for up to 3
  days, so the default budget stays well below that horizon.

### 3. Safe reconciliation of unmatched captures

- On every redelivery, before declaring the event unmatched, the handler
  reconciles via the PayPal order id carried inside the signed event
  (`resource.supplementary_data.related_ids.order_id`): if an order with that
  `paypalOrderId` exists (capture endpoint crashed before its DB write, or
  the order row was created late), the event is applied to it and the
  capture id / transaction id are recorded
  (`result: 'order_updated_reconciled'`).
- The capture endpoint (`capturePayPalPayment`) also sweeps
  `unresolved`/`failed` webhook events for the capture it just applied and
  closes them (`result: 'order_updated'`) — covering the classic race where
  the webhook arrives while the capture request is still in flight.
  Mismatch-flagged events are never auto-closed.

### 4. Identity, amount and currency verification before any order write

Before an order is updated (webhook path), ALL of the following must hold:

- **Identity** — the event's capture id equals the order's recorded
  `paypalCaptureId`, or the event's `related_ids.order_id` equals the order's
  `paypalOrderId` AND that order has no conflicting capture id
  (`capture_order_mismatch` otherwise). A capture belonging to a different
  order is never grafted.
- **Amount** — `resource.amount.value` (in integer cents) equals
  `order.total` (in cents).
- **Currency** — `resource.amount.currency_code` equals `order.currency`.

A mismatch is terminal: the order is left untouched, the event is recorded as
`unresolved` / `amount_currency_mismatch` or `capture_order_mismatch`,
acknowledged (retrying cannot fix a deterministic mismatch) and alerted.
Structural validation now also requires a well-formed `amount` on
`PAYMENT.CAPTURE.COMPLETED` events (fail-closed 400 before any DB write).

Refunded orders are never clobbered back to `completed`; completing a
pending/failed order is idempotent.

The capture endpoint enforces the same expected-payment guarantee using
PayPal's trusted capture API response (409 + alert on mismatch, order not
marked paid).

## Tests (backend/__tests__)

- `webhookUnmatchedCapture.spec.js` (new) — unmatched deferral, delayed order
  creation reconciliation, bounded-retry exhaustion + alert, amount/currency
  verification, cross-order capture (graft) rejection, refunded-order
  protection, malformed amount rejection.
- `captureEndpointVerification.spec.js` (new) — capture amount/currency
  verification (ok / amount mismatch / currency mismatch) and the webhook
  reconciliation sweep (uses the new `setPayPalClientForTests` seam).
- `webhookIdempotency.spec.js` — the no_matching_order test now pins the
  deferral behavior; the failure-seam stub follows the new guarded
  `updateOne` write path.
- `helpers.mjs` — webhook fixtures now mirror real PayPal capture payloads
  (amount + supplementary_data).

Full backend suite: **10 suites / 88 tests passing** (baseline before the
fix: 8 / 76 — no regressions). Run with:

```bash
cd backend && npm run test:security
```

## Configuration

```bash
# .env
WEBHOOK_MAX_UNMATCHED_ATTEMPTS=10   # bounded retry budget for unmatched captures
```

## Ops runbook (unresolved events)

```js
// Events awaiting manual reconciliation:
db.webhookevents.find({ status: 'unresolved' })
// Terminal (budget exhausted):
db.webhookevents.find({ status: 'unresolved', result: 'no_matching_order_retry_exhausted' })
// Verification failures (investigate immediately):
db.webhookevents.find({ result: { $in: ['amount_currency_mismatch', 'capture_order_mismatch'] } })
```

Alert lines are prefixed `🚨 PAYMENT WEBHOOK ALERT [` and carry a JSON
payload (event id, capture id, related order id, attempt counts) with no PII.
