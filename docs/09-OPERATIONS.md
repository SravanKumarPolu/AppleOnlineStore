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
