# TEST_COVERAGE_MATRIX — NovaCart Feature ↔ Code ↔ Test Traceability

**Date:** 2026-10-25 · **Source of truth:** executed suites (see TEST_EXECUTION_REPORT) + `docs/07-TESTING_PLAN.md` §4, updated for the 2026-10-25 invariant pass
**Legend:** ✅ automated & passing · 🟡 partial · 🧪 manual-only · ❓ owner-pending · ⛔ gap

---

## 1. Executed inventory (final state, all green)

### 1.1 Backend — 31 suites / 293 tests (Jest, in-memory MongoDB, real HTTP)

| Suite | Tests | Protects |
|---|---|---|
| `adversarialInputValidation` | 19 | Malformed/adversarial input on every reachable vector → safe 4xx, never 500/partial write |
| `authenticationAttacks` | 18 | Invalid/expired/tampered JWTs, alg-confusion, privilege escalation, enumeration, brute force |
| `authorizationIdorAttacks` | 13 | Cross-user order reads/writes, product/category mutation, status changes by shoppers |
| `businessLogicCartCheckout` | 15 | Duplicate adds, quantity semantics, duplicate order submission, deleted products, empty cart, address validation |
| `concurrencyRaceConditions` | 7 | R-1 duplicate-fulfillment prevention under 2/10/50/100-way races; R-2 cart; R-3 status; R-4 stock |
| `inventoryPricingIntegrity` | 10 | P-1 trusted totals, P-2 price validation, I-1/I-2 reserve & no-oversell, I-3/I-4 restore/release |
| `injectionWebSecurity` | 16 | NoSQL injection, stored XSS, path traversal, header hygiene, CORS, upload types, data exposure |
| `loggingRedaction` | 17 | URI/error/Bearer redaction; canary against unreachable DB; global error handler |
| `analyticsAggregation` | 10 | Admin analytics reads (authz), tracking, sales/product/user/search aggregations, K-12 robustness |
| `productCatalogReads` | 12 | Public pagination/sort/filters/search, single product 404/400, no-analytics-on-public-reads pin |
| `productImageLifecycle` | 6 | Admin add/remove image lifecycle via the `setCloudinaryForTests` seam: no-images 400, upload success → secure URLs + color/bestseller/stock coercion, upload-failure 500 (nothing persisted), remove 404, publicId extraction (K-13), destroy-failure still deletes (6, 2026-10-25 pass) |
| `categoryManagement` | 12 | Full category CRUD contract: duplicate names case-insensitive, rename conflicts with self-exclusion, soft-delete retention, whole subcategory lifecycle (400/404/duplicate/rename/remove) (12, 2026-10-25 pass) |
| `checkoutIdempotency` | 4 | AF-1 replay mechanism: same key → one order + one stock reservation, distinct keys → distinct orders, oversized-key 400, 5-way concurrent same-key converges to exactly one order (unique-index backstop) (4, 2026-10-25 pass) |
| `userAuthRegistrationLogin` | 8 | Register (real bcrypt, verifiable JWT), duplicates, weak password, login semantics, no enumeration |
| `userAddressBook` | 9 | All 5 address routes: authz, CRUD semantics, cross-user 404, first-address pin |
| `cartCategoryAddressAuthorization` | 13 | Cart IDOR closure (spoofed `userId` inert), admin 403 on cart, 6 category mutations guarded |
| `adminAuthorization` | 9 | 401/403 matrix on status/debug endpoints, status enum validation, admin 200 + persistence |
| `adminAuthentication` | 7 | Admin login contract, wrong creds 401, issued token passes `authAdmin` |
| `userAccountLockout` | 3 | 5-failure lock (423), expired-lock restart, success clears counter |
| `passwordResetEmail` | 3 | K-4 call contract + rendered email (name greeting, FRONTEND_URL link), no enumeration |
| `passwordResetConsumption` | 7 | Token swap (hash verified, old password dead), expired/weak/missing → 400 unchanged |
| `orderPaymentMethods` | 7 | K-1 COD/Card persistence, non-whitelisted method 400 (nothing persisted), 401 |
| `paypalOrderCreate` | 6 | Pending PayPal order persisted, approve link, strict-USD capture edge, 401/400, outage mapping |
| `paypalWebhook` | 6 | Valid event completes order; invalid/missing signature 400 fail-closed; replay ignored |
| `webhookIdempotency` | 9 | State machine: acquisition, lock window, failure marking, interrupted/failed/legacy recovery |
| `webhookUnmatchedCapture` | 8 | Delayed-order reconciliation via `related_ids`, unmatched→unresolved retryable, budget→terminal ack, mismatch gates |
| `captureEndpointVerification` | 4 | 409 amount/currency mismatch, unresolved sweep after trusted update |
| `healthEndpoints` | 8 | live/ready/legacy semantics, 503 while draining (DB still up), secret-free payloads |
| `gracefulShutdown` | 12 | Ordered teardown, idempotent signals, bounded lifecycle, force once, drain 503 + health passthrough |
| `startupShutdown.integration` | 2 | Real `node server.js` child: readiness 503→200, SIGTERM→exit 0, DB-down→exit 1, no secret leak |
| `startupValidation` | 13 | Env matrix, fatal/warning escalation, placeholder detection, value-leak check, wiring before connect |

### 1.2 Frontend (storefront) — 12 files / 57 tests (Vitest + RTL)

ShopContext guard · Product page · PayPalPayment wrapper · useCart · useWebSocket · BestSeller · LatestCollection · ProductItems · PlaceOrder checkout wiring (COD/Card submit, cart clear, redirect, failure/empty/login guards, K-11 delivery-form address save) · AddressBook (all K-11 mutation URLs/methods/payloads) · plus the suites added by the 2026-10-25 pass.

### 1.3 Admin — 13 files / 70 tests (Vitest + RTL)

apiTypes (11) · Login (5) · Navbar (2) · Sidebar (4) · dashboard (4) · orders (6) · add (4) · list (7) · salesAnalytics (6) · productAnalytics (6) · userAnalytics (5) · searchAnalytics (5) · MobileNav + NotFound (5, K-6 fix) — every shipped page and chrome component, fetch contracts incl. Bearer auth, default 30-day windows, filter re-fetches, render/error/loading/empty states, deleted-product row filtering, nav↔route parity, mobile-nav↔sidebar destination sync, catch-all 404 contract.

### 1.4 Browser E2E — 13 specs (Playwright, real Chromium, real backend + real DB)

`checkout.spec.ts` — COD money path (register → browse → product → color + cart → cart page → delivery form → COD order → redirect → order verified via API with the browser token) · Card money path · Install-App non-blocking.
`ui-audit.spec.ts` — every routed page renders without console errors/failed requests · unknown route → NotFound · product detail + related · search + category filter · mobile viewport (iPhone 12: layout adapts, bottom nav, no horizontal scroll) · keyboard navigation to search/primary links · empty login submit blocked · protected route redirect · session persists across refresh · a11y structure (landmarks, alt text, single h1).

## 2. Feature ↔ code ↔ test matrix

| Feature (PRD ref) | Primary code | Coverage |
|---|---|---|
| User registration/login | `userController.loginUser/registerUser` | ✅ `userAuthRegistrationLogin` (8) |
| Account lockout | `userModel` lock machinery | ✅ `userAccountLockout` (3) |
| Password reset — send | `requestPasswordReset` | ✅ `passwordResetEmail` (3) — K-4 locked |
| Password reset — consumption | `resetPassword` | ✅ `passwordResetConsumption` (7) |
| Admin login | `adminLogin` | ✅ `adminAuthentication` (7) |
| Cart CRUD + ownership | `cartController` + routes | ✅ `cartCategoryAddressAuthorization` (13) — IDOR closed |
| Product list/search/single | `productController` | ✅ `productCatalogReads` (12) + storefront vitest |
| Product add/remove (admin) | `productController` | ✅ `productImageLifecycle` (6) + authz paths (`adminAuthorization`/`cartCategoryAddress`) — Cloudinary edges spec-locked via seam (K-13 fixed here) |
| Category CRUD + guards | `categoryController` | ✅ `categoryManagement` (12) + `cartCategoryAddressAuthorization` (13) |
| Address book CRUD (API + UI) | `userController` + `AddressBook/PlaceOrder` | ✅ `userAddressBook` (9) + `AddressBook.test.tsx` (5) + PlaceOrder case — K-11 locked |
| COD/Card order placement | `placeOrder` | ✅ `orderPaymentMethods` (7) + E2E (real browser, real DB) — K-1 locked |
| **Stock reservation / oversell** | `orderController` reserve/release | ✅ `inventoryPricingIntegrity` (10) + `concurrencyRaceConditions` R-4 — I-1/I-2/I-3/I-4 locked (K-5 closed 2026-10-25) |
| **Trusted order totals** | `placeOrder` price recomputation | ✅ `inventoryPricingIntegrity` P-1/P-2 |
| PayPal order create | `placeOrderPayPal` | ✅ `paypalOrderCreate` (6) |
| PayPal capture + gates | `capturePayPalPayment` | ✅ `captureEndpointVerification` (4) |
| PayPal webhook signature (fail-closed) | `paypalWebhookService` | ✅ `paypalWebhook` (6) |
| Webhook idempotency state machine | `handlePayPalWebhook` + `webhookEventModel` | ✅ `webhookIdempotency` (9) |
| Unmatched-capture recovery | `processCaptureCompletedEvent` | ✅ `webhookUnmatchedCapture` (8) |
| Admin order status (whitelist) | `updateStatus` | ✅ `adminAuthorization` (9) |
| Realtime order events | `socketService` | 🟡 null-safe emitters via shutdown specs; end-to-end socket flow 🧪 |
| Analytics tracking + admin reads | controllers + `analyticsController` | ✅ `analyticsAggregation` (10) + 4 admin page suites — K-12 locked |
| Health endpoints | `app.js` | ✅ `healthEndpoints` (8) |
| Graceful shutdown | `shutdownManager` | ✅ `gracefulShutdown` (12) + integration (2) |
| Startup guardrails | `startupValidation` | ✅ `startupValidation` (13) |
| Log redaction | `utils/redact.js` | ✅ `loggingRedaction` (17) |
| Storefront cart context / hooks | `src/context`, `useCart`, `useWebSocket` | ✅ storefront vitest |
| PayPal button wrapper | `PayPalPayment.tsx` | ✅ vitest (wrapper only) |
| Checkout end-to-end (browser) | `PlaceOrder.tsx` | ✅ Playwright COD+Card vs real stack |
| Admin panel surface | `admin/src` | ✅ 13 files / 70 tests (full shipped surface, incl. mobile nav + 404 since the K-6 fix) |
| **PayPal client-id configuration** | `PlaceOrder.tsx` | ✅ no hardcoded fallback remains (K-2 closed 2026-10-25) — explicit unavailability message asserted in vitest |
| Live PayPal (sandbox/live) | — | ❓ NOT RUN — owner action, `docs/devops/08` |
| Real SMTP delivery | `emailService` | 🧪 contract-locked (`passwordResetEmail` renders the real template); live delivery NOT RUN |
| Admin 404 route / mobile nav | `App.tsx`, `Sidebar`, `MobileNav`, `NotFound` | ✅ K-6 FIXED 2026-10-25 — catch-all route + `lg:hidden` mobile strip, locked by `MobileNav.test.tsx` (5) |
| Cross-browser (Safari/Firefox) | — | ⛔ NOT RUN — engines not available in sandbox (Chromium-only E2E) |

## 3. Code coverage (instrumented runs)

| App | Lines | Branches | Functions | Notes |
|---|---|---|---|---|
| backend | 77.4 % (1419/1833) | 70.4 % | 76.9 % | jest --coverage + `scripts/gen-coverage-summary.mjs`, 34 instrumented files |
| frontend | 36.8 % (643/1747) | 36.4 % | 31.6 % | vitest 5 coverage-v8 — measures `src/**` only (config excludes tests/scaffolding); native-v8 counting is NOT comparable to the pre-vitest-5 istanbul-remapped figures (was 28.4/62.8) — suite itself unchanged at 57/57 |
| admin | 80.0 % (463/579) | 60.9 % | 78.2 % | vitest 5 coverage-v8 — full shipped surface; same methodology note (was 92.3/74.0 under istanbul remapping); suite unchanged at 70/70 |

Critical-path line coverage (backend, jest-instrumented only):

| File | Lines | Reading |
|---|---|---|
| `orderController.js` | 82.9 % | money path incl. reserve/release + idempotent replay; residual = admin status/list branches covered indirectly |
| `cartController.js` | 83.5 % | |
| `userController.js` | 76.8 % | |
| `paypalWebhookService.js` | 73.0 % | |
| `paypalEnv.js` / `webhookEventModel.js` | 100 % | |
| `analyticsController.js` | 65.0 % | aggregations covered by 10 behavioral tests; long formatting branches remain |
| `productController.js` | 70.4 % | public reads + admin add/remove image lifecycle via seam (2026-10-25 pass: 30.9→70.4); residual = unrouted `updateProductStock` (documented no-wire zone) + controller guards made unreachable by express-validator (defense-in-depth, spec-header documented) |
| `categoryController.js` | 88.9 % | full CRUD contract (2026-10-25 pass: 29.6→88.9); residual = console-formatting lines |

**Honest assessment against the "critical business logic ≥ 90 %" goal:** behavioral (invariant-level) coverage of the money path is complete and locking — every P/I/R/K invariant has a failing-on-old-code spec. Line coverage on the *narrow* critical files (orderController, cartController, paypal services, models) is 73–100 %; the ≥90 % line-coverage bar is met by `paypalEnv`/`webhookEventModel` only. The 2026-10-25 coverage pass closed the two worst controllers (categoryController 29.6→88.9, productController 30.9→70.4) and backend totals moved 67.8→77.4 lines / 59.9→70.4 branches. FE/admin rows were re-measured after the vitest 5 toolchain upgrade — the coverage-v8 major switched from istanbul-remapped to native-v8 counting, so those numbers move without any test change; the suites are identical (57/57, 70/70). Remaining backend shortfall is dominated by (a) formatting branches in `analyticsController` (65 %), (b) code exercised by Playwright E2E against the real server, which jest instrumentation cannot credit, and (c) deliberately-uncovered code documented in spec headers: the unrouted `updateProductStock` (no-wire zone without owner approval) and controller guards made unreachable by express-validator middleware (defense-in-depth). We report the real numbers rather than inflating them.

## 4. Gaps register (prioritized, honest)

1. **Live PayPal validation** (owner) — mocks are only as good as mocks; `docs/devops/08` checklist stays ❓ until run on a staging host. Also blocks the PayPal *branch* of browser E2E.
2. **Cross-browser engines** — Safari/Firefox NOT RUN (unavailable in sandbox); Chromium-only E2E.
3. ~~**Admin 404 route + mobile nav** (K-6)~~ — ✅ RESOLVED 2026-10-25 (catch-all route + `MobileNav`, locked by 5 admin tests; kept here for history).
4. **Realtime socket E2E** — emitter null-safety covered; full socket.io flow manual-only.
5. **Real SMTP delivery** — contract locked, live send NOT RUN (no SMTP in sandbox).
6. ~~**`productController`/`categoryController` line coverage**~~ — ✅ RESOLVED 2026-10-25 coverage pass: direct line-level suites added (`productImageLifecycle` 6 + `categoryManagement` 12); controllers now 70.4 % / 88.9 % lines (see §3).
