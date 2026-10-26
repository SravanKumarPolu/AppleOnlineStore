# NovaCart — Final Stabilization & Production-Readiness Report

**Date:** 2026-10-26 · **Branch:** `main` (working tree changes uncommitted) ·
**Decision:** **CONDITIONAL PASS** — the code gates pass, but production
release is **not** authorised while the PayPal sandbox lifecycle and provider
credential rotation remain unresolved.

> Rule applied: only what was executed is reported as verified. External
> dependencies that could not be exercised are marked **BLOCKED**, never
> inferred from mocks.

---

## 1. What was inspected

**Applications:** `backend/` (Express/Mongoose/Socket.IO), `frontend/`
(React/Vite PWA), `admin/` (React/Vite).

**Backend code:** `controllers/orderController.js` (place/capture/webhook/
refund/status), `services/reservationService.js`, `services/socketService.js`,
`services/paypalWebhookService.js`, `config/{startupValidation,paypalEnv}.js`,
`models/orderModel.js`, `models/webhookEventModel.js`, `middleware/auth.js`,
`routes/orderRoute.js`, `app.js`, `server.js`.

**Scripts:** `paypal-sandbox-check.mjs`, `scan-secrets.mjs`, `load-test.mjs`,
`e2e-server.mjs`, `verify-startup.mjs`.

**Tests:** all 41 backend specs (focus: `refundWorkflow`,
`reservationExpiry`, `socketRealtime`, `webhookIdempotency`,
`webhookUnmatchedCapture`, `captureEndpointVerification`,
`inventoryPricingIntegrity`, `concurrencyRaceConditions`), frontend unit
suites, 3 Playwright specs.

**Docs:** `AGENTS.md`, `README.md`, `docs/01`–`09`, `docs/devops/00`, `07`,
`08`, `09`, the existing load artifact and `.env.example` files.

## 2. Reused unchanged (verified sufficient)

| Area | Why it was kept |
|---|---|
| Webhook state machine (signature → structural validation → atomic acquisition → verification gates → order write) | Correct and fail-closed; extended only with a refund-event branch |
| Capture verification (capture id/order id identity, amount in cents, currency) | Already blocked partial/foreign captures; added only a cancelled/refunded guard |
| Server-side pricing + atomic stock reservation (`stockQuantity >= qty`, `$inc`, oversell floor 0) | Correct; no changes |
| Idempotency key for COD/Card (`userId + idempotencyKey` unique partial index) | Correct; no changes |
| PWA install flow (`beforeinstallprompt`, user-initiated, dismissal/installed state) | Correct; unchanged |
| Room-based Socket.IO delivery | Correct design; only authorization and key derivation fixed |
| CORS allowlist, log redaction, shutdown manager, startup guardrails | Correct; unchanged |

## 3. Confirmed defects and root causes

| ID | Defect | Root cause | Correction |
|---|---|---|---|
| **K-13** | A failed stock restoration was lost permanently | `stockReserved` cleared first; per-product credits best-effort with `catch { log }`; no retry state | Atomic claim now records `inventoryRestoration:'pending'`; per-item `stockRestored` marker set after success; boot + 5-min sweep retries; structured alert |
| **K-14** | Duplicate refunds possible; `PENDING` recorded as refunded | Intent recorded after the gateway call; no separate refund state; refund events ignored | Atomic claim **before** gateway; `refundStatus` (`pending/completed/failed`); 202 for PENDING; indeterminate stays reconcilable; `PAYMENT.CAPTURE.REFUNDED` reconciliation with amount+currency checks |
| **K-15** | Late capture could resurrect a cancelled/refunded order | Capture update filtered only on `paypalOrderId + userId`; wrote `completed` + `Order Placed` unconditionally | Pre-flight `409 ORDER_NOT_PAYABLE`; atomic cancelled/refunded guard `409 CAPTURE_REQUIRES_RECONCILIATION`; capture id stored for refund; ops alert |
| **K-16** | Any authenticated socket could join any order room; shopper updates silently dropped | No ownership check on `join_order_room`; populated `userId` stringified to `[object Object]` | Ownership check + typing allow-list; room key from `_id`/`toHexString()`; two-tab-safe disconnect |
| — | Secret scanner blind spot | All assignment checks skipped in fixtures | Fixtures scanned; only short/obviously synthetic values waived |
| — | Sandbox helper could call live PayPal | Built `LiveEnvironment` when `PAYPAL_ENV=live` | `--create`/`--capture` refuse with exit 2 before any request |
| — | Load results measured the rate limiter and inventory exhaustion | Only 5xx counted; seeded stock 10; limiter 1000/15 min | 4xx + per-scenario success reported; deep stock; limiter raised only on the disposable target; stock-consistency assertion |
| — | Accessibility failures (axe) | Badge colours overridden by daisyUI; `text-yellow-600` ≈3.1:1; a `Contact Support` button whose aria-label omitted its visible text (WCAG 2.5.3); scans ran mid-animation / over not-yet-revealed cards | Explicit badge colours; yellow-800/red-700; aria-label removed (visible text is the name); scans reveal the page, finish animations, then scan |
| — | WebKit mobile overflow / 404 noise | Monitor entry `x:300` counted in scrollWidth; WebKit omits URLs from 404 console messages | Vertical entry animation; 404 URLs captured and attributed |

## 4. Modified files and why

| File | Reason |
|---|---|
| `backend/services/reservationService.js` | Durable restoration state machine, atomic cancel-on-claim, retry sweep + alerts |
| `backend/models/orderModel.js` | `items[].stockRestored`, `inventoryRestoration`, `refundStatus/Attempts/LastError`, sweep index |
| `backend/controllers/orderController.js` | Refund claim/state machine, refund webhook reconciliation, capture guards, shared durable release |
| `backend/services/socketService.js` | Order-room authorization, typing allow-list, safe room key, two-tab disconnect |
| `backend/app.js` | Optional `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` (defaults unchanged) |
| `backend/server.js` | Boot runs full inventory sweep (expiry + owed restorations) |
| `backend/scripts/{paypal-sandbox-check,scan-secrets,load-test,e2e-server,verify-startup}.mjs` | Live-PayPal refusal, fixture-safe scanner, valid load measurement, E2E limits, synthetic fixture value |
| `backend/.env.example` | Documents `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX`; env set verified at 35 |
| Tests (`refundWorkflow`, `reservationExpiry`, `socketRealtime`, `webhookIdempotency`, +2 new specs) | Regression coverage for every correction |
| `frontend/src/components/{ProductItems,PerformanceMonitor,OurPolicy}.tsx` | WCAG contrast fixes; no horizontal-overflow entry animation; label-in-name fix |
| `frontend/e2e/{a11y,ui-audit}.spec.ts` | Settled-state scans; 404 attribution by URL |
| Frontend unit tests (3 files) | Updated to the intentionally improved accessible names (WCAG 2.5.3) |
| `docs/01–09`, `docs/devops/00,07,08`, `AGENTS.md`, `README.md` | As-built contract updates; counts, state machines, runbooks, blocked status |
| `docs/testing/load-results-2026-10-26-post-fix.json` | New load artifact (old artifact retained, marked non-comparable) |

## 5. Regression coverage added/changed

- `refundWorkflow.spec.js` — **15** tests: authz; completed-only; atomic claim under
  concurrency (one gateway call); `PENDING` → 202 and not refunded; timeout →
  reconcilable and retry-blocked; definitive 4xx → `failed` and retryable;
  signed refund webhook completes/fails/mismatches; duplicate webhook does not
  double-credit stock.
- `reservationExpiry.spec.js` — **10** tests: TTL; release once; live/COD/paid
  untouched; late capture after cancellation; **failed credit stays owed and is
  retried**; multi-item at-most-once; deleted product settles; capture refused
  pre-flight and across an in-flight cancellation.
- `socketRealtime.spec.js` — **7** tests: real server↔client delivery, token
  refusal, reconnect, populated-user update, **foreign room join refused**,
  two-tab disconnect.
- `webhookIdempotency.spec.js` — event type used for "ignored" updated because
  refunds are now handled; all 9 tests pass.
- `secretScanner.spec.js` — **7** tests; `sandboxScriptSafety.spec.js` — **2**.
- `frontend/e2e/a11y.spec.ts` + `ui-audit.spec.ts` — settled-state axe scans,
  404 attribution, mobile overflow measurement.

## 6. Executed gates (this machine: darwin x64, 16 vCPU, Node 24.20.0)

| Gate | Command | Result |
|---|---|---|
| Backend regression | `cd backend && npm run test:security` (identical to `npm test`; final run used `npm test`) | **41 suites / 404 tests PASS** |
| Backend lint | `npm run lint` | PASS |
| Backend syntax | `npm run build` (`node --check`, 98 files) | PASS |
| Backend startup | `npm run verify:startup` | PASS (see §6.1) |
| Backend coverage | `npm run test:coverage` | PASS — 41 suites / 404 tests; **78.06 % statements / 78.91 % lines / 69.69 % branches / 79.5 % functions** |
| Frontend unit | `npm run test -- --run` | **24 files / 125 tests PASS** |
| Frontend lint / types | `npm run lint` · `npm run type-check` | PASS |
| Frontend build | `npm run build` | PASS (PWA `sw.js` + workbox generated) |
| Admin unit | `npm run test -- --run` | **13 files / 70 tests PASS** |
| Admin lint / types / build | `npm run lint` · `npm run type-check` · `npm run build` | PASS |
| Browser matrix | `cd frontend && npm run test:e2e` | **51/51 PASS** (17 × Chromium/Firefox/WebKit) |
| npm audit (read-only) | each app | backend 0 · admin 0 · frontend 3 moderate (build-time Tailwind/PostCSS), no high/critical |
| Secret scan | `cd backend && npm run security:secrets` | Clean (tree + full history) |
| PayPal sandbox check | `npm run paypal:sandbox -- --check` | Exit 2 — `PAYPAL_WEBHOOK_ID` missing |
| PayPal sandbox create | `npm run paypal:sandbox -- --create` | Sandbox order `7HC18984P46126319` (CREATED); no approval/capture |
| Load / reliability | `npm run load:test` | See §7 |

### 6.1 Startup verification

`verify:startup` spawns the real `server.js` against in-memory MongoDB and
asserts readiness flips to 200, the process exits 0 on SIGTERM, and no canary
secret appears in output. It passed in this run.

## 7. Performance / reliability (new artifact)

`docs/testing/load-results-2026-10-26-post-fix.json` — disposable in-memory
backend on `127.0.0.1:3101`, deep seeded stock, rate limiter raised **only**
there, 15 s per level.

| VUs | Requests | Throughput | p50 | p95 | p99 | 5xx | 4xx | Checkout success |
|---|---|---|---|---|---|---|---|---|
| 1 | 1,415 | 94.3 rps | 6.1 ms | 34.2 ms | 46 ms | 0 % | 0 % | 100 % (122/122) |
| 10 | 2,495 | 166.3 rps | 45.1 ms | 155.1 ms | 206.8 ms | 0 % | 0 % | 100 % (234/234) |
| 50 | 2,749 | 183.3 rps | 211.8 ms | 709 ms | 852.5 ms | 0 % | 0 % | 100 % (287/287) |
| 100 | 2,715 | 181 rps | 423.8 ms | 1,475.8 ms | 2,279.8 ms | 0 % | 0 % | 100 % (278/278) |
| 250 | 2,640 | 176 rps | 714.8 ms | 4,232.7 ms | 16,323 ms | 0 % | 0 % | 100 % (229/229) |

- Stop rule triggered at 250 VU (p95 > 3 s) — expected and documented.
- **Stock consistency:** initial 1,000,000 → final 998,850; 1,150 successful
  orders; expected 998,850 → **consistent**.
- **Recovery:** `/health/ready` avg 1.7 ms, all 200 after load.
- **RSS:** 91–114 MB. **CPU: unavailable on macOS (reported as null, never 0).**
- These are **not** production capacity numbers and are **not comparable** to the
  old artifact (which counted only 5xx and measured limiter responses). Do not
  reuse them as a capacity claim.
- Backend env template verified at **35** variables (the preserved baseline says
  30; the additions are `PAYPAL_PAYEE_EMAIL`, `PAYPAL_RESERVATION_TTL_MS`,
  `RESERVATION_SWEEP_INTERVAL_MS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`).

## 8. PayPal sandbox evidence

> `docs/devops/07` and `docs/devops/08` are preserved Phase 1 records. Their
> status lines are **superseded by this section and §9** — they were not edited.

| Step | Result |
|---|---|
| Environment selection | ✅ `PAYPAL_ENV=sandbox` (`config/paypalEnv.js`) |
| Credentials present | ✅ client id + secret, not placeholders |
| Sandbox order creation | ✅ order `7HC18984P46126319`, status `CREATED` — **no charge** |
| Buyer approval | ⛔ BLOCKED — no sandbox buyer session; order left unapproved |
| Capture + capture id | ⛔ BLOCKED — requires approval |
| `PAYPAL_WEBHOOK_ID` | ⛔ MISSING — `--check` exits 2 |
| Public HTTPS webhook | ⛔ BLOCKED — no public host/tunnel |
| Signed webhook / duplicates / delayed / invalid signature | 🟡 Offline specs only (mocked edge) |

**Conclusion:** real PayPal end-to-end remains **UNVERIFIED**. No capture id,
webhook receipt or provider response was fabricated. The exact owner actions
are: set `PAYPAL_WEBHOOK_ID`, expose the backend on HTTPS, register
`PAYMENT.CAPTURE.COMPLETED` + `PAYMENT.CAPTURE.REFUNDED`, approve with a
sandbox buyer, then run `--capture` and replay the signed events.

## 9. Credential rotation and Git history

- Working tree + **full git history** scanned clean with the hardened scanner.
- `JWT_SECRET` / `ADMIN_PASSWORD`: **VERIFIED ROTATED** (2026-10-24 live check,
  `docs/devops/09`).
- PayPal secret/webhook id, MongoDB, SMTP, Cloudinary: **ROTATION REQUIRED**
  (dashboard owner actions; a clean repo is not a rotation).
- Git-history purge of the canonical repository: **not performed** — requires
  explicit owner approval for a history rewrite/force-push (`docs/devops/07`).

## 10. Refund and inventory consistency assessment

- Refund: `paymentStatus:'refunded'` **only** when `refundStatus:'completed'`.
  PENDING/timeout/5xx stays `pending`, blocks a second automatic refund, and is
  settled by the signed `PAYMENT.CAPTURE.REFUNDED` event or manual
  reconciliation. Concurrent requests produce exactly one gateway refund
  (tested).
- Inventory: every release is an atomic claim + durable obligation. A failed
  product credit remains `reconciliation_required` and is retried at boot and
  every sweep; each item is credited at most once via `items[].stockRestored`.
  Deleted/invalid products are settled, not retried forever.
- Residual: the one-write crash window between a successful credit and its
  marker is documented (`docs/09` §5.2); a product-side idempotency ledger
  would be required to eliminate it.
- Late capture after cancellation is refused pre-flight and across the in-flight
  race; money is never taken for an order whose stock was returned.

## 11. Socket.IO evidence

Real server + real `socket.io-client`: shopper and admin receive their events;
anonymous/invalid tokens refused; reconnect re-registers; a populated user
reference now addresses `user_<id>`; a different authenticated shopper **cannot**
join the owner's `order_<id>` room and receives no private event; disconnecting
one of two tabs keeps the user registered; graceful shutdown closes the server.

## 12. Browser, accessibility and PWA results

| Engine | Tests | Result |
|---|---|---|
| Chromium | 17 | ✅ 17/17 |
| Firefox | 17 | ✅ 17/17 |
| WebKit | 17 | ✅ 17/17 |

Covered: signup/login (UI), catalog, product detail, search/filter, cart,
COD and Card checkout against the real backend, order checks, PWA install
button (user-initiated, does not block login), routed pages, 404, mobile
viewport (no horizontal scroll), keyboard navigation, session persistence,
landmarks/alt text/single H1. axe-core: 4 page types × 3 engines, no
critical/serious violations **after** the badge/contrast fixes and
settled-state scanning.

**Not claimed:** full WCAG 2.2 AA conformance. Automated scans cover roughly
half of real accessibility defects; **manual screen-reader testing was not
performed** and is recorded as a gap. PWA offline/update behavior was exercised
by unit tests, not by a browser offline session.

## 13. Remaining production blockers

1. **PayPal sandbox end-to-end is BLOCKED** — needs `PAYPAL_WEBHOOK_ID`, a
   public HTTPS endpoint, and a sandbox buyer approval/capture.
2. **Provider credential rotation is outstanding** — PayPal secret/webhook id,
   MongoDB, SMTP, Cloudinary (owner dashboard actions).
3. **Git-history purge of the canonical repo** — owner approval required;
   rotation must happen regardless.
4. **Manual accessibility verification** (screen reader, zoom/reflow) — not
   executed.
5. **Production capacity is unmeasured** — numbers above are a local,
   disposable-host baseline only.
6. Frontend carries 3 moderate build-time advisories (Tailwind 3/PostCSS);
   upgrade window is a planned task.

## 14. Git diff summary and recommended commit message

**39 files staged, uncommitted** (~3,050 insertions, ~280 deletions): 35
modified files, two new test specs (`secretScanner.spec.js`,
`sandboxScriptSafety.spec.js`), this report, and the new load artifact
`docs/testing/load-results-2026-10-26-post-fix.json`. No secrets, no dependency
upgrades, no infrastructure, no history rewrite. Nothing was committed, tagged,
force-pushed or written to a remote.

Recommended commit message:

```
fix(payments,inventory,realtime): durable refund and stock-restoration state
machines, capture-after-cancel guards, private order rooms, and verifiable
quality gates

- refunds: claim intent before the gateway; refundStatus pending/completed/
  failed; signed PAYMENT.CAPTURE.REFUNDED reconciliation (K-14)
- inventory: inventoryRestoration + per-item stockRestored + retry sweep (K-13)
- capture: refuse cancelled/refunded orders pre-flight and atomically (K-15)
- socket: order-room ownership check, populated-user room key (K-16)
- quality: cross-browser E2E fixes, WCAG contrast, load-harness validity,
  secret-scanner fixture hardening, sandbox helper live guard
- docs: as-built contract, runbooks, blocked PayPal/rotation status
```

## 15. Final decision

**CONDITIONAL PASS.**

The engineering gates that can be executed here pass: 404 backend tests, 125
storefront tests, 70 admin tests, 51 cross-browser E2E checks, zero audit
high/critical, clean secret scan, and a load run with 0 errors and exact stock
consistency. Payment capture cannot falsely succeed, refunds cannot be
duplicated or falsely finalized, stock cannot be permanently lost through a
failed restoration, and private order events do not cross users.

Production release is **not** approved because real PayPal sandbox behaviour,
provider credential rotation, and the canonical-repo history decision remain
externally blocked. Close those, then this report can be re-issued as PASS.
