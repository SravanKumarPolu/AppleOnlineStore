# 08 — PayPal Sandbox Validation Checklist (Pre-Production Blocker: *Pending*)

**Status:** READY TO EXECUTE — every scenario below can be run against the
sandbox topology with no code changes. Requires: a publicly reachable HTTPS
backend (staging host or a tunnel such as `ngrok http 4000`) and sandbox
credentials.

**Purpose:** validate the REAL PayPal integration end-to-end — signature
verification, capture, and the unmatched-capture recovery behavior added in the
webhook fix (doc 06) — before flipping `PAYPAL_ENV=live`.

---

## 0. Topology & configuration

- [ ] Staging `.env`:

```bash
NODE_ENV=production           # prod build, intentionally sandbox — expect exactly ONE warning
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=<sandbox app id>      # Developer Dashboard -> Apps & Credentials -> Sandbox tab
PAYPAL_CLIENT_SECRET=<sandbox app secret>
PAYPAL_WEBHOOK_ID=<sandbox webhook id>
WEBHOOK_MAX_UNMATCHED_ATTEMPTS=10      # default; lower (e.g. 3) to shorten retry-exhaustion tests
```

- [ ] Startup log shows `🔧 STARTUP CONFIG: PayPal environment: SANDBOX` plus the
      single expected warning about prod-build-on-sandbox — and **no others**
      (extra warnings mean a credential is missing/placeholder — fix first)
- [ ] Developer Dashboard → Sandbox → your app → **Webhooks → Add Webhook**:
      URL `https://<host>/api/orders/paypal/webhook`, events `PAYMENT.CAPTURE.COMPLETED`
      (+ refund events if in scope). Copy the webhook ID into `.env` if not already.
- [ ] Sandbox buyer + facilitator test accounts exist under Dashboard → Sandbox → Test Accounts

## 1. Happy path — capture + verified webhook

- [ ] Frontend checkout with the **sandbox buyer** account (sandbox PayPal window)
- [ ] Backend log: capture response status `COMPLETED`; order row shows
      `paymentStatus: completed`, `paypalCaptureId` set, `orderStatus: Order Placed`
- [ ] Webhook arrives and logs a verified `order_updated` (or is acknowledged as a
      duplicate when the capture endpoint won the race — both correct)
- [ ] Cart cleared; user + admin sockets received the status update; confirmation email sent (if SMTP configured)

## 2. Signature verification (fail-closed)

- [ ] Replay the same webhook payload with an altered header signature or from an
      unlisted URL: expect **400** `Webhook signature verification failed`, and no DB change
- [ ] Temporarily blank `PAYPAL_WEBHOOK_ID` and restart: expect every delivery to be
      rejected with reason `missing_webhook_id` in behavior (400), then restore

## 3. Unmatched capture — deferred & retried (the Phase 1 fix)

Simulates: order row not yet visible when the capture completes (delayed creation
or capture-endpoint race).

- [ ] Trigger a capture whose order is deliberately delayed (e.g. pause the DB /
      create the PayPal order via API and hold the DB write, or temporarily stop
      the app between PayPal order creation and capture)
- [ ] Expect: webhook responds **500** (`No matching order yet`), event record in
      `webhookevents` has `status: unresolved`, `result: no_matching_order`, log line
      `🔔 PayPal webhook deferred ... attempt 1/10`
- [ ] Let the order row appear, then let PayPal redeliver (or re-POST the same event
      with fresh-ish headers): expect reconciliation — order flips to
      `paymentStatus: completed`, event becomes `completed` with
      `result: order_updated_reconciled`, HTTP **200**

### 3a. Retry exhaustion (only with a disposable webhook ID budget)

- [ ] With `WEBHOOK_MAX_UNMATCHED_ATTEMPTS=3` and no order ever created: after the
      3rd delivery expect HTTP **200** with `No matching order after 3 attempts`,
      event `unresolved` / `no_matching_order_retry_exhausted`, and the ops log line
      `🚨 PAYMENT WEBHOOK ALERT [no_matching_order_retry_exhausted]`
- [ ] Confirm the alert pattern is routed by the log pipeline; restore the env default after

## 4. Amount / currency / identity gates

- [ ] Craft a verified delivery whose amount differs from the order total (e.g.
      modify the order total between creation and capture): expect
      `unresolved` + `amount_currency_mismatch`, **order NOT marked paid**, alert raised
- [ ] Same with a different `currency_code`: same rejection
- [ ] Refund an order in the sandbox dashboard, then re-deliver its
      `PAYMENT.CAPTURE.COMPLETED`: the refunded order must **not** be clobbered back
      to `completed`
- [ ] Optional cross-order graft test (two orders, swap the capture id): expect
      `capture_order_mismatch` + alert, neither order modified

## 5. Capture endpoint verification + race sweep

- [ ] Normal capture (matches): 200, order completed, and any webhook events left
      `unresolved` for that capture are swept to `completed` (`result: order_updated`)
- [ ] Simulated mismatch (tamper the expected total after PayPal order creation):
      expect **409** `Captured amount or currency does not match the order total`, order
      stays unpaid, `🚨 PAYMENT WEBHOOK ALERT [capture_amount_mismatch]` in logs

## 6. Idempotency & duplicate deliveries

- [ ] Re-POST a processed event: expect **200** `Duplicate event ignored`, no second DB write
- [ ] Two concurrent deliveries of the same event: exactly one processes; the other gets
      500 `Event is currently being processed` and is retried later

## 7. Readiness sign-off

- [ ] All scenarios above behave as specified
- [ ] `🚨 PAYMENT WEBHOOK ALERT` lines appear in the log pipeline (alert routing confirmed)
- [ ] One final full regression run: `node --experimental-vm-modules node_modules/.bin/jest --runInBand`
      → 11 suites / 101 tests green
- [ ] Snapshot the `webhookevents` collection state (all events terminal: `completed` or
      alert-flagged `unresolved`) — nothing left dangling

**After sign-off:** switch the production `.env` per
`07-CREDENTIAL-ROTATION-RUNBOOK.md` §3–4 (`PAYPAL_ENV=live`, live credentials, live
webhook ID), redeploy, and run the doc 07 go-live gate. Both remaining Phase 1
blockers then close together.
