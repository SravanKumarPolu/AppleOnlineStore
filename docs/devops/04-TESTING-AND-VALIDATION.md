# Phase 1 Testing & Validation — NovaCart

> Every result below was produced by actually executing the command on
> 2026-10-23 in this repository, including the Final Security & Reliability
> Gate re-run. Nothing is predicted or assumed.

## 1. Test infrastructure

| Package | Runner | Files | Note |
|---|---|---|---|
| frontend | Vitest 3 + @testing-library/react (existing, added in the earlier Phase 1 lint/testing session) | 8 | jsdom, 26 tests |
| admin | **none** | 0 | No test runner in devDependencies; `test`/`type-check` scripts do not exist — reported as MISSING, not faked |
| backend | **jest 29.7 + supertest 6.3.3 + mongodb-memory-server 9.1.3** (devDependencies that existed unused; now wired via `jest.config.mjs`) | 8 spec files, 76 tests | Node ESM mode (`--experimental-vm-modules`), `--runInBand`, in-memory MongoDB 7.0.14 |

Backend test conventions: fixtures match real model schemas (schema-drift
bugs found earlier proved hand-maintained fixtures rot — helpers build
users/orders via the actual models); the ONLY mocks sit at network edges
(PayPal HTTP client; child-process net I/O is real); all security decision
logic, middleware chains, and DB writes execute for real.

Run commands:

```
cd backend && npm run test:security     # new Phase 1 security/regression suite
cd backend && npm test                  # pre-existing 7-category runner
cd frontend && npm run test -- --run    # vitest
```

## 2. Backend security/regression suite — ACTUAL RESULTS (final gate re-run)

`npm run test:security` → exit 0. **8 suites, 76/76 tests passed, 43.7 s.**

| Spec file | Tests | Covers |
|---|---|---|
| `adminAuthorization.spec.js` | 9 | 401 unauthenticated on status/debug/user-debug; 403 user-token (both header formats — bypass attempt); 400 invalid status enum (DB untouched); 200 admin + DB persisted; debug endpoints 401/403/200 |
| `paypalWebhook.spec.js` | 6 | valid event → order completed + correct PayPal verify request built (webhook id, transmission headers, raw-body event); invalid signature → 400 + order untouched; missing headers → 400, PayPal never called; malformed body → 400; missing webhook id → fail-closed; duplicate event → 200 + single DB update (replay resets order to pending and proves no re-processing) |
| `webhookIdempotency.spec.js` (NEW) | 9 | **Task 1 regression**: stale `processing` re-acquired + processed; fresh lock → 500 + untouched; `failed` re-processed; legacy no-status records recovered; order-update throw → 500 + `failed` record (with redacted lastError) → retry delivery re-processes to completion; completed-duplicate acknowledged without re-processing; `no_matching_order` and `ignored_event_type` recorded; malformed capture resource rejected BEFORE any DB write |
| `cartCategoryAddressAuthorization.spec.js` (NEW) | 13 | **Task 4 regression**: all 4 cart routes 401 unauthenticated; invalid token 401; cross-user read/write/update with spoofed body userId land on the CALLER's cart while victim data is proven untouched (IDOR closed); admin tokens 403 on cart; owner read+sync still works; category list public; all 6 category mutations 401/403 (user) and admin add → real DB write; address save 401 unauthenticated / 201 authenticated |
| `healthEndpoints.spec.js` | 8 | live 200; ready 200 with DB / 503 without; **ready 503 during drain even while DB connected + composed db-down+drain case + drain-state getter** (final gate); no secrets/connection strings in any health payload; legacy `/health` unchanged |
| `gracefulShutdown.spec.js` | 12 | ordered teardown (drain→sockets→db); idempotent duplicate signal; bounded timeout on hanging close; survives failing closers; app drain 503 for non-health, health stays up, readiness 503 during drain, recovery after drain cleared; **whole lifecycle bounded when sockets+DB hang (forced:true); one-time onForceExit notification; closeAllConnections on http timeout; clean shutdown never forced; budget-exhausted phases skipped-and-reported** (final gate) |
| `loggingRedaction.spec.js` | 17 | URI redaction (standard/SRV/`@`-in-password/no-creds/non-string); error redaction; summary form; **`redactText` (Bearer/Basic, JWT-shaped tokens, message+stack for Errors, non-string input); direct invocation of the exported global error handler (redacted dev message, generic production message, ValidationError/CastError/11000 semantics)** (final gate); **canary integration**: `connectDB()` against unreachable host with canary password → canary never in captured console output |
| `startupShutdown.integration.spec.js` | 2 | **Real `node server.js` child process**: readiness 503→200 after DB init, live+root served, SIGTERM → exit 0 with graceful logs (re-verified after the exit-code change: clean shutdown still exits 0), canary env secret never in output; unreachable DB → exit 1 fail-fast, redacted, never "ready" |

## 3. Backend pre-existing suite (regression) — ACTUAL RESULTS (final gate re-run)

`node /home/z/my-project/scripts/run_backend_tests_with_infra.mjs`
(ephemeral mongodb-memory-server + SMTP stub; same harness used in the
earlier Phase 1 session) → exit 0, **7/7 categories passed**
(environment, database, email, security, analytics, performance,
integration). This re-run after the final-gate changes (cart/category/address
route guards, webhook state machine, app/server error-handler changes, engines
`>=22`) proves existing behavior did not regress.

Plain `npm test` without that harness still requires live MongoDB+SMTP+env
vars and honestly fails — documented, not hidden.

## 4. Frontend — ACTUAL RESULTS (final gate re-run)

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | 0 errors / 0 warnings (incl. the `AdminCategories.tsx` token-header change) |
| `npm run type-check` (`tsc --noEmit`) | 0 | PASS |
| `npm run test -- --run` | 0 | **8 files, 26/26 tests passed** (product listing/detail, cart, hooks regression, PayPal wrapper, WebSocket, ShopContext guard) |
| `npm run build` | 0 | PASS (PWA precache generated) |

Frontend source delta in the final gate: exactly one file —
`src/pages/AdminCategories.tsx` (unrouted orphan page) now attaches the
stored token header to its `/api/category/add` request. No UI redesign;
no other component touched.

## 5. Admin — ACTUAL RESULTS (final gate re-run)

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | 0 errors / 0 warnings |
| `npm run build` | 0 | PASS |
| `npm run test` / `type-check` | — | **MISSING** — scripts do not exist in `admin/package.json` (dev/build/lint/preview only). Reported explicitly per instructions; not counted as success. |

Admin source delta in the final gate: **none** (the admin panel already
sends the admin token on `/api/orders/status` and category mutations are
not called from the admin app).

## 6. Backend lint/build — ACTUAL RESULTS (final gate re-run)

| Command | Exit | Result |
|---|---|---|
| `npm run lint` (ESLint 8.57.1) | 0 | 0 errors / 0 warnings (includes all final-gate changes: webhook state machine, routes, controllers, shutdown manager, redact, 8 spec files) |
| `npm run build` | 0 | Placeholder echo (no compile step for the Node backend — pre-existing, reported as such) |

Node runtime check (final gate, Task 6): executed on Node **v24.21.0**
(supported LTS; Node 18 reached end-of-life 2025-04). `engines.node` updated
`"18.x"` → `">=22"` — no dependency or code changes were required: the full
matrix above (including the real-process startup/shutdown integration test
and the 7-category suite) passed on v24 both before and after the field
change.

## 7. Mocked vs. real PayPal validation (explicit distinction)

- **Mocked (executed here)**: every webhook test stubs ONLY the PayPal HTTP
  client at the network edge — signature-verification decision logic,
  fail-closed paths, the idempotency state machine, and all DB writes run
  for real against in-memory MongoDB. The capture flow is not exercised
  against live PayPal in automated tests.
- **Real (external, pending)**: end-to-end webhook verification requires a
  PayPal sandbox webhook pointed at the deployed backend with
  `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`/`PAYPAL_WEBHOOK_ID` configured,
  plus a real sandbox capture to trigger `PAYMENT.CAPTURE.COMPLETED`. This
  remains an owner-side validation step — it is NOT claimed as done here.

## 8. Limitations

- Backend jest suite downloads a MongoDB 7.0.14 binary on first run on
  Debian 12/13 hosts (~1 min once, cached afterwards); older hosts may need
  `MONGOMS_VERSION` override.
- Admin package has no automated tests (infrastructure decision pending).
- The startup integration test binds port 4571 on the test host.
- Timing-sensitive shutdown tests use small budgets (40–80 ms) and real
  timers; the manager treats an http-phase timeout as budget exhaustion
  precisely to keep these deterministic under load.
