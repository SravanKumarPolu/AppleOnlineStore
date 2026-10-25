# Phase 1 Reliability & Health — NovaCart

> All behaviors below are implemented and verified by execution
> (backend `__tests__`: healthEndpoints, gracefulShutdown,
> loggingRedaction, startupShutdown.integration, webhookIdempotency —
> 76/76 passing across 8 suites, incl. the final gate).

## 1. Startup sequence and readiness

`server.js` (post Phase 1) runs a strictly ordered, awaited startup:

```
import app (no side effects: no listen, no DB, no sockets)
  └─ await connectDB()            # fails fast: redacted error, exit 1
       └─ await connectCloudinary()
            └─ socketService.initialize(server)
                 └─ server.listen(PORT, '0.0.0.0')
                      └─ SIGTERM/SIGINT handlers active
```

Verified by a real-process integration test (`node server.js` spawned as a
child against an in-memory MongoDB): `/health/ready` returns 503 until the
DB is connected, then 200 — the server never reports ready before its
required dependency is up.

### Failure handling
- DB unreachable → `connectDB` throws → `startServer` catch logs a
  **redacted** message and exits 1. Verified by test: child exits 1 within
  seconds, output contains `Startup failed`, contains no credentials, and
  never logs "Server started".
- `unhandledRejection` → logged (redacted), process continues.
- `uncaughtException` → logged (redacted), exit 1.
- Before Phase 1, `connectDB()` was fire-and-forget: the server listened
  before the DB connected and DB failure called `process.exit` from inside
  the connection helper. Both issues are fixed.

## 2. Health endpoints

| Endpoint | Semantics | Codes | Payload |
|---|---|---|---|
| `GET /health/live` | Process liveness only (no dependency checks) | 200 | `{status:'live', uptime}` |
| `GET /health/ready` | Readiness incl. required DB availability **and not draining** | 200 / 503 | `{status, checks:{database[, shuttingDown]}}` |
| `GET /health` | Legacy compatibility (unchanged) | 200 | original payload |

- Readiness reflects `mongoose.connection.readyState === 1`.
- **Final gate (Task 2)**: during graceful shutdown, `/health/ready` returns
  **503 for the entire drain window even while MongoDB is still connected**
  (`checks.shuttingDown:true`, `checks.database:true` — honest reporting), so
  load balancers stop routing for the whole shutdown, not just after the DB
  drops. Liveness and the legacy endpoint intentionally stay 200 so probes
  can observe the final state. Verified by dedicated tests in
  `healthEndpoints.spec.js` and `gracefulShutdown.spec.js`.
- All three are tested to contain no connection strings or secret material.
- During graceful shutdown, health endpoints remain served (so probes can
  observe final state) while other routes return 503.

## 3. Graceful shutdown

`utils/shutdownManager.js` (dependency-injected, unit-tested):

1. **Idempotency** — a second SIGTERM/SIGINT (or manual re-invocation) is
   ignored with a log line; `server.close` runs exactly once (tested).
2. **Drain** — app-level flag makes all non-health routes return
   `503 {success:false, message:'Server is shutting down'}` and readiness
   report 503 (tested via supertest).
3. **Ordered teardown** — HTTP server stop → Socket.IO close → MongoDB
   `connection.close(false)` (order asserted by test).
4. **Bounded COMPLETE lifecycle (final gate, Task 3)** — one deadline
   (default 10 000 ms, `SHUTDOWN_TIMEOUT_MS`) bounds the entire
   http → sockets → database cleanup: the http phase is raced against the
   full budget, and each later phase is raced against the remaining budget.
   Consequences, all unit-tested:
   - a hanging `server.close` resolves via the force timer AND
     force-destroys lingering keep-alive sockets (`server.closeAllConnections`);
   - hanging `closeSockets`/`closeDatabase` cannot stall the chain past the
     budget (tested with never-settling promises — the whole lifecycle
     completes in ≈ the budget);
   - an http-phase timeout exhausts the budget by definition: later phases
     are skipped-and-reported (deterministic), never silently ignored;
   - any cleanup timeout triggers a ONE-time `onForceExit` notification and
     sets `forced:true` in the result, and `server.js` exits **1** instead of
     0 — unclean shutdowns surface in orchestrator logs; a clean shutdown
     still exits 0 (real-process integration test re-verified exit 0).
5. **Resilient** — failing close callbacks are logged and do not abort the
   sequence (tested).
6. Signals: `SIGTERM` and `SIGINT` both map to the same handler.

New capability: `socketService.close()` closes the Socket.IO server and
clears connection state; emit helpers are null-safe so a closed/not-yet-
initialized realtime layer can never crash order-update flows (this was a
real bug found by the Phase 1 tests: `PUT /api/orders/status` used to 500
when sockets were unavailable).

## 3a. Webhook processing reliability (final gate, Task 1)

PayPal retries webhook deliveries when the previous attempt failed or the
endpoint answered non-2xx. The final gate replaced the naive
insert-before-process dedupe (which acknowledged retries as duplicates even
when the order update had never happened) with a **recoverable idempotency
state machine** on the `webhookevents` collection:

- `status: processing → completed | failed`, with `attempts`, redacted
  `lastError`, `completedAt`, and a `result`
  (`order_updated` / `no_matching_order` / `ignored_event_type`).
- Acquisition is atomic (unique `eventId` index). A retry is acknowledged
  as a duplicate ONLY for `status === 'completed'`.
- `failed`, stale `processing` (older than `WEBHOOK_PROCESSING_LOCK_MS`,
  default 30 s), and legacy no-status records are re-acquired and
  re-processed — safe because the order update itself is idempotent.
- A fresh `processing` lock answers 500 (PayPal retries later) — it is never
  acknowledged while another delivery is mid-flight.
- Processing failures mark the record `failed` and answer 500, so the retry
  re-processes; the capture-resource shape is validated BEFORE any DB write
  so a malformed body cannot strand a record.
- The regression that motivated this (`webhookIdempotency.spec.js`):
  delivery 1's order update throws → 500 + `failed` record → PayPal retries
  → delivery 2 re-processes and completes the order. Under the previous
  implementation, that retry received 200 "Duplicate event ignored" and the
  payment event was silently lost.

## 4. Logging hygiene

- Mongo connection logs show host/db only; failures show redacted errors.
- Redaction helpers (`utils/redact.js`) handle `@`-containing passwords and
  SRV URIs; the final gate added `redactText` (message + stack, Bearer/Basic
  credentials, JWT-shaped tokens) used by the global error handler, and made
  the URI lookahead line-bounded so an `@` on a later line (e.g. the same URI
  repeated in a stack trace) can no longer prevent redaction of an earlier
  occurrence. All regression-tested, including direct invocation of the
  exported error handler.
- PayPal capture logs status/ids only (full payloads only in
  non-production); userOrders no longer dumps request bodies; cart controller
  error logs are redacted.

## 5. Test-verified scenarios summary

| Scenario | Result |
|---|---|
| Readiness during startup (before/after DB connect) | ✅ 503 → 200 |
| Readiness after DB disconnect | ✅ 200 → 503 |
| **Readiness during shutdown while DB still connected** | ✅ 503 (final gate) |
| Liveness independent of DB | ✅ 200 always |
| Startup with unreachable DB | ✅ exit 1, redacted log, never "ready" |
| SIGTERM graceful shutdown | ✅ exit 0, ordered teardown, no SIGKILL |
| Duplicate signals | ✅ ignored, single teardown |
| Hanging server.close | ✅ bounded + closeAllConnections |
| **Hanging sockets AND database closes** | ✅ whole lifecycle bounded ≈ budget, forced:true (final gate) |
| **Cleanup timeout handling** | ✅ one-time onForceExit notification, exit 1 (final gate) |
| New requests during shutdown | ✅ 503 (health stays 200) |
| Credential leakage into logs | ✅ canary tests negative |
| **Webhook interrupted processing → retry re-processes** | ✅ order completed on retry, never falsely acknowledged (final gate) |
| **Webhook failed processing → retry recovers** | ✅ failed → re-acquired → completed (final gate) |
