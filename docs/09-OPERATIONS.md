# NovaCart — Operations Guide

> **Status:** Current as of 2026-10-24. This guide indexes the operational
> knowledge that already exists in the preserved Phase 1 records
> (`docs/devops/`) and adds the runbook view for the webhook recovery
> behavior shipped afterwards.
>
> **Chain:** … → [06-DEPLOYMENT.md](./06-DEPLOYMENT.md) →
> [07-TESTING_PLAN.md](./07-TESTING_PLAN.md) → [08-SECURITY.md](./08-SECURITY.md)
> → **this file**

## 1. Health endpoints & probing

| Probe | Target | Semantics |
|---|---|---|
| Liveness | `GET /health/live` | 200 while the process exists — no dependency checks. Point your "is the process alive" probe here |
| Readiness | `GET /health/ready` | 200 only when MongoDB is connected **and not draining**; 503 otherwise (incl. the **entire** drain window while DB is still up — so load balancers reroute before teardown) |
| Legacy | `GET /health` | Compatibility endpoint, always 200 when up |

All health payloads are booleans/status strings only — never connection
strings or secret names (tested). `/api/socket/status` reports the realtime
connected-user count.

## 2. Startup, drain, and shutdown behavior

- **Startup is strictly ordered and fail-fast**: guardrails (`startupValidation`)
  run **before** MongoDB/Cloudinary/Socket.IO/listen; fatal misconfigurations
  (live PayPal + placeholder creds; production without `JWT_SECRET`) exit 1
  before opening any resource. DB failure → redacted log + exit 1, never
  "half-up".
- **Drain**: on SIGTERM/SIGINT a flag makes every non-health route answer
  `503 {success:false, message:'Server is shutting down'}`; readiness goes
  503; health stays up so probes can observe the end state.
- **Teardown order**: HTTP close → Socket.IO close → MongoDB close — all
  bounded by one budget (`SHUTDOWN_TIMEOUT_MS`, default 10 s). A hanging
  HTTP close force-destroys keep-alive sockets; budget-exhausted later phases
  are skipped-and-reported; any forced cleanup triggers a one-time
  notification and **exit 1** (clean shutdowns exit 0). Duplicate signals
  are ignored.
- **Process-level nets**: `uncaughtException` → redacted log + exit 1;
  `unhandledRejection` → redacted log, process continues.
- Operational meaning: **exit code 1 on shutdown = investigate** (lingering
  connections forced); exit 0 = clean.

## 3. Logging (what goes where, what never appears)

- No logger library — `console.*` routed through `utils/redact.js` at every
  error site. Mongo connections log host/db summaries only. Bearer/Basic
  credentials and JWT-shaped strings are scrubbed from messages **and
  stacks**. PayPal capture payloads log in full only outside production.
  Production 500s are generic (`Internal Server Error`).
- Known noise (hygiene backlog): 14 `console.log`s in the admin panel
  (including a 20-char token prefix in `orders.tsx`) and verbose analytics
  request logging in `analyticsController`.
- **There is no log aggregation/rotation in the repository** — supervising
  the process includes supervising its stdout/stderr (planned: roadmap
  Phase 8).

## 4. Realtime layer (Socket.IO) operations

- One process, one port; handshake is JWT-authenticated (bad token →
  connection refused).
- Rooms: `user_<id>`, `admin_room`, `order_<id>`. Server→client events:
  `order_updated` (+ `payment_update`/`shipping_update` variants),
  `new_order`, `user_typing`/`user_stop_typing`.
- **Order rooms are private.** A shopper socket may join `order_<id>` only after
  the server verifies the order belongs to that account; admins join by role.
  Typing relays require a joined room. An ObjectId is not a secret — never
  relax this to "the id is hard to guess".
- The personal room key is derived from `userId._id` when a populated user
  document is passed (`user_[object Object]` was a real silent-drop bug).
- All emitters are null-safe: if realtime is down/uninitialized, order flows
  still succeed (this fixed a real 500-on-status-update bug).
- `socketService.close()` is part of the shutdown order — no orphaned
  sockets across restarts.

## 5. PayPal webhook operations runbook

The endpoint (`POST /api/orders/paypal/webhook`) is fail-closed and
recoverable-by-design. Operational states live in the **`webhookevents`**
collection:

| State | Meaning | Operator action |
|---|---|---|
| `processing` (fresh, < `WEBHOOK_PROCESSING_LOCK_MS` = 30 s) | In flight | None — wait |
| `processing` (stale) | Interrupted | None — next delivery re-acquires automatically |
| `completed` | Fully applied | None; future duplicates are acked |
| `failed` | Processing threw (see `lastError`, redacted) | None required — retry re-processes; recurring `failed` = real bug, capture the `lastError` + PayPal event id |
| `unresolved` (`attempts` < `WEBHOOK_MAX_UNMATCHED_ATTEMPTS` = 10) | Verified capture that could not be safely applied yet (no matching order / amount-currency-identity mismatch) | Watch it — most resolve on redelivery (delayed order creation) |
| `unresolved` (budget exhausted, result `no_matching_order_retry_exhausted`) | Terminal — PayPal stops retrying; an **ops alert** was logged | **Manual review required**: find the capture id in PayPal dashboard, locate/repair the order, then reconcile by hand (see [docs/devops/06-WEBHOOK-UNMATCHED-CAPTURE-FIX.md](./devops/06-WEBHOOK-UNMATCHED-CAPTURE-FIX.md)) |

Quick checks:

```bash
# Webhook failing closed? (missing PAYPAL_WEBHOOK_ID etc.)
curl -s -X POST https://<host>/api/orders/paypal/webhook \
  -H 'Content-Type: application/json' -d '{}'          # expect 400

# Recent webhook outcomes (Mongo shell)
db.webhookevents.find({}, {eventId:1, eventType:1, status:1, attempts:1,
  result:1, lastError:1}).sort({updatedAt:-1}).limit(20)
```

Verification gates encoded in code (never bypass): capture identity,
amount-in-cents vs `order.total`, currency vs `order.currency`, cross-order
grafts rejected, refunded orders never modified. The capture endpoint
(`POST /api/orders/paypal/capture`) verifies the same way (409 on mismatch)
and sweeps `unresolved` events after a trusted update.

### 5.1 Refund reconciliation (`refundStatus`)

A refund is **not** finished because the API request was sent. `refundStatus`
is the operator-facing truth:

| State | Meaning | Action |
|---|---|---|
| `null` | No refund requested | — |
| `pending` | Requested; PayPal has not confirmed (PENDING result, timeout, 5xx, unknown status) | Check the PayPal dashboard for the refund id. If it completed, the signed `PAYMENT.CAPTURE.REFUNDED` webhook will settle it; otherwise reconcile manually. The API refuses a second automatic refund (`409 REFUND_PENDING_RECONCILIATION`) — **do not** force-repeat it |
| `completed` | Money returned; `paymentStatus:'refunded'`; inventory released exactly once | None |
| `failed` | Definitive provider rejection (4xx) — no refund exists | Safe to retry the endpoint |

```bash
# Refunds stuck pending (Mongo shell)
db.orders.find({refundStatus:'pending'}, {paymentStatus:1, refundId:1,
  refundMethod:1, refundReason:1, refundLastError:1, refundAttempts:1})
```

Alerts to route: `PAYMENT WEBHOOK ALERT [refund_indeterminate]`,
`[refund_unknown_order]`, `[refund_amount_currency_mismatch]`,
`[refund_unknown_status]`.

### 5.2 Inventory restoration (owed stock credits)

A release claims `stockReserved:false` and records a **durable** restoration
obligation. Once claimed, the units are owed to the catalog until every item is
credited; a failed product write is retried by the sweep (every
`RESERVATION_SWEEP_INTERVAL_MS`, default 5 min, and once at boot).

| `inventoryRestoration.status` | Meaning | Action |
|---|---|---|
| `none` | Nothing released yet | — |
| `pending` | Claimed, credit not finished (e.g. crash between claim and credit) | None — the next sweep resumes; watch it |
| `completed` | Every item credited exactly once | None |
| `reconciliation_required` | At least one item failed to credit (`lastError`, `attempts`) | Investigate the product id in `lastError`; the sweep keeps retrying. If it never clears, credit stock manually **once** and set `items[].stockRestored` for that item |

```bash
# Owed restorations (Mongo shell)
db.orders.find({'inventoryRestoration.status': {$in:['pending','reconciliation_required']}},
  {_id:1, orderStatus:1, paymentStatus:1, 'inventoryRestoration':1,
   'items.productId':1, 'items.quantity':1, 'items.stockRestored':1})
```

Alerts to route: `INVENTORY RESTORATION ALERT [unresolved_stock_restoration]`,
`[sweep_unresolved]`. These mean sellable stock is temporarily missing —
they are not routine noise.

**Exactly-once guarantee (2026-10-26):** the stock increment and its proof are
one atomic `findOneAndUpdate` on the product document: `$inc: {stockQuantity}`
plus `$addToSet: {restorationCredits: '<orderId>:<itemIndex>'}` with a
`restorationCredits: {$ne: creditId}` filter. MongoDB guarantees single-document
atomicity, so the credit and the evidence that it was applied can never
disagree after a crash or a concurrent retry — no replica set or multi-document
transaction is required. `items[].stockRestored` on the order is bookkeeping
only; losing it is harmless because the retry proves the credit from the ledger.

**Growth / pruning:** the ledger keeps one short string per restored order line
per product (typically tens per day across the catalog). `reservationDebits` is
bounded by **active** holds — an entry is created with the debit and removed by
the credit that returns it — so it does not grow over time. Do **not** prune
`restorationCredits` entries while an order's `inventoryRestoration.status` is
`pending` or `reconciliation_required`; an entry is only provably disposable
long after its order reached `completed`. If a retention policy is ever needed,
prune only by order id after confirming there is no unresolved obligation, and
record it here.

**Creation-time reservation (K-21, fixed 2026-10-26 fourth pass):** the
checkout path no longer decrements before the order exists. The order is
inserted as a **draft** (`stockReservation.status:'pending'`, `stockReserved:false`),
each line's decrement writes a `<orderId>:<itemIndex>` marker in the SAME
product update (`reservationDebits`), and the reservation is then committed
atomically (`stockReserved:true`, status `reserved`). A draft that never
committed is settled by `releaseAbandonedReservations()` — part of the same
sweep, at boot and every `RESERVATION_SWEEP_INTERVAL_MS` — which credits
exactly the marked lines (marker-guarded, so a retry or a racing sweep cannot
double-credit), then deletes the draft. A draft younger than 2 minutes
(`ABANDONED_RESERVATION_MS`) is left alone so a live request is never swept.

```bash
# Uncommitted drafts and their state (Mongo shell)
db.orders.find({'stockReservation.status': {$in:['pending','releasing','failed']}},
  {_id:1, 'stockReservation':1, 'items.productId':1, 'items.quantity':1})
```

Alert to route: `INVENTORY RESERVATION ALERT [unresolved_draft_release]` — a
draft line could not be credited and is retried every sweep.

## 6. Credential rotation & PayPal validation (owner runbooks)

- **Rotation (⛔ pending, blocker S1):** full per-credential procedures with
  blast radius + rollback:
  [docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md](./devops/07-CREDENTIAL-ROTATION-RUNBOOK.md).
  Rotation order matters (PayPal secret before flipping `PAYPAL_ENV=live`).
- **Sandbox validation (❓ pending):** 8-scenario end-to-end checklist incl.
  deferred/unmatched captures, retry exhaustion, fail-closed signature,
  mismatch gates, race sweep, idempotency:
  [docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md](./devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md).

## 7. Email & Cloudinary operations

- Email: nodemailer/SMTP; wired flows are **welcome** and **password-reset**
  (reset email rendering fixed 2026-10-24 — K-4 closed; the greeting uses the
  customer's name and the link is built from `FRONTEND_URL` + token).
  Order-confirmation/status/low-stock/security templates
  exist but are never invoked.
- Cloudinary: product images land in the `ecommerce/products` folder
  (800×800 limit, auto quality/format). Product removal deletes the images
  best-effort (failure logs a warning, never blocks deletion). Orphaned
  images after failed deletes must be cleaned in the Cloudinary console.
- Local `backend/uploads/` is a transient multer spool dir only (77 dev
  artifacts are committed by accident — do not treat it as storage).

## 8. Data operations

- **Backups**: nothing in the repo — owner/deployment responsibility
  (MongoDB Atlas continuous backup or `mongodump` cron).
- **Retention**: no TTL indexes; `useractivities`, `searchanalytics`, and
  `webhookevents` grow unbounded. Prune old `completed` webhook events only
  after PayPal's redelivery window is comfortably past (weeks, not minutes).
  Admin helper: `POST /api/analytics/cleanup` (orphaned analytics records).
- **Soft deletes**: `isActive:false` hides products/users/orders from
  normal queries — prefer it over hard deletes.

## 9. Incident playbook (based on real behavior)

| Symptom | Likely cause | Action |
|---|---|---|
| Orders stuck `pending`, webhook 400s in PayPal dashboard | Signature verification failing (wrong `PAYPAL_WEBHOOK_ID`, wrong environment, missing transmission headers at a proxy) | Fix config; endpoint fails closed by design — never "open it up" |
| Orders stuck `pending`, capture 409s | Amount/currency/capture mismatch | Compare PayPal capture vs order in DB; do not hand-edit `paymentStatus` without the evidence trail |
| `webhookevents` filling with `unresolved` | Orders not matching captures (delayed creation, race, mismatch) | Usually self-heals within the retry budget; if exhausted → §5 manual review |
| Boot exits 1 instantly with a config report | Guardrail fired (live+placeholder creds / prod without JWT_SECRET) | Read the report (names only), fix env, restart — this is the system working |
| Exit 1 after SIGTERM (not 0) | A closer hung past the budget | Check for lingering keep-alive connections/sockets; not data loss, but investigate |
| Frontend can't reach API (CORS errors in console) | Origin not in allowlist | Add `FRONTEND_URL`/`ADMIN_URL` (or fix proxy origin) |
| Admin login 500 | `ADMIN_EMAIL`/`ADMIN_PASSWORD` unset | Set env (guardrail also warns at boot) |
| Password reset emails with a hex-string greeting | Defect K-4 (historical) | **Fixed 2026-10-24** — if it recurs, a caller is again mismatching `sendPasswordResetEmail(email, name, resetToken)` |

## 10. Monitoring status (honest)

There is **no monitoring, alerting, or log aggregation in the repository** —
the only observability today is the health endpoints, structured startup/
shutdown logs, and the webhook ops alerts (console). Uptime watching on
`/health/ready` is the minimum interim measure; full observability is
DevOps roadmap Phase 8 (Planned).
