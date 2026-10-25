# NovaCart — Testing Plan & Traceability (As-Built)

> **Status:** Test inventory verified 2026-10-24 — updated the same day with
> the K-1/K-4 fix specs, then with the **test-gap closure pass** driven by
> this file's traceability matrix (§4), then with the **K-11/K-12 fix
> locks + the admin Orders/Add/List suite extension**, and then with the
> **admin analytics + Sidebar suite** (sales/product/user/search pages and
> the Sidebar). Baseline: **backend 21 suites / 173 tests PASS · frontend
> 10 files / 38 tests PASS · admin 12 files / 65 tests PASS · storefront
> E2E 2 specs PASS (real browser vs the real backend).** This file is the
> authoritative command reference — several npm scripts lie (see §3).
>
> **Chain:** … → [05-API_REFERENCE.md](./05-API_REFERENCE.md) →
> [06-DEPLOYMENT.md](./06-DEPLOYMENT.md) → **this file** →
> [08-SECURITY.md](./08-SECURITY.md). Phase 1 execution record:
> [docs/devops/04-TESTING-AND-VALIDATION.md](./devops/04-TESTING-AND-VALIDATION.md)
> (76-test snapshot at its date; since grown to 173).

## 1. Backend suite (jest, ESM mode)

**Canonical command** (this is what CI and humans should run):

```bash
cd backend && npm run test:security
# = node --experimental-vm-modules node_modules/.bin/jest --runInBand
```

Infrastructure: in-memory MongoDB (mongodb-memory-server 7.0.14 binary —
first run downloads ~1 min, then cached; `MONGOMS_VERSION` override for odd
hosts), supertest against the side-effect-free `app.js`, and a
**real-process** startup/shutdown integration spec (binds port 4571).
Conventions: fixtures are built through the real models (schema-drift
defense); the only mocks sit at network edges (PayPal HTTP client); every
security decision and DB write executes for real.

| Spec | Tests | Covers |
|---|---|---|
| `paypalWebhook.spec.js` | 6 | Valid event → order completed + correct verify request; invalid signature → 400 untouched; missing headers/webhook id → fail-closed; malformed body; duplicate → acked without re-processing |
| `webhookIdempotency.spec.js` | 9 | State machine: stale lock re-acquired; fresh lock → 500; `failed` re-processed; legacy no-status recovered; order-update throw → failed + 500 → **retry completes**; completed duplicate acked; `no_matching_order`/`ignored_event_type` recorded; malformed capture rejected before any DB write |
| `webhookUnmatchedCapture.spec.js` | 8 | Delayed order creation → redelivery reconciles via `related_ids.order_id`; unmatched → `unresolved` + retryable 500; budget exhausted → terminal ack + alert; amount/currency/capture-order mismatch gates; refunded orders never clobbered |
| `captureEndpointVerification.spec.js` | 4 | Capture endpoint amount/currency verification (409 on mismatch); unresolved-event sweep after trusted API update |
| `adminAuthorization.spec.js` | 9 | 401/403 matrix on status/debug/user-debug; invalid status enum → 400 DB-untouched; admin 200 + DB persisted |
| `cartCategoryAddressAuthorization.spec.js` | 13 | Cart IDOR closure (spoofed body `userId` inert, victim untouched); admin tokens 403 on cart; 6 category mutations guarded; `/api/address/save` guarded; public list stays public |
| `healthEndpoints.spec.js` | 8 | live/ready/legacy semantics; ready 503 during drain while DB connected; secret-free payloads |
| `gracefulShutdown.spec.js` | 12 | Ordered teardown; idempotent signals; hanging closers bounded; whole-lifecycle budget; onForceExit once; clean shutdown never forced |
| `startupShutdown.integration.spec.js` | 2 | Real `node server.js` child: readiness 503→200; SIGTERM → exit 0; canary secret never in output; unreachable DB → exit 1 |
| `startupValidation.spec.js` | 13 | Env-selector matrix; fatal/warning escalation matrix; placeholder detection; value-leak check; guardrails wired before `connectDB` |
| `loggingRedaction.spec.js` | 17 | URI/error/text redaction (incl. Bearer/JWT shapes); global error handler direct invocation; canary integration against unreachable DB |
| `orderPaymentMethods.spec.js` | 7 | **K-1 fix:** COD + Card orders persist via `POST /api/orders` (`paymentStatus:'pending'`, totals, cart cleared, order linked to user); non-whitelisted methods (`stripe`, `cod`, `Paypal`) → 400 with nothing persisted; 401 unauthenticated |
| `passwordResetEmail.spec.js` | 3 | **K-4 fix:** controller calls `sendPasswordResetEmail(email, name, resetToken)` (no token in the greeting slot, no URL in the token slot); unknown email stays 200 without a send; rendered email greets by name with a working `FRONTEND_URL`-based link |
| `userAuthRegistrationLogin.spec.js` | 8 | *Gap closure:* register 201 (real bcrypt hash stored, verifiable JWT, no plaintext) / duplicate email 400 / weak password 400 / invalid email 400 (nothing persisted); login 200 (token + `lastLogin`), wrong password 401, unknown email 401 (no enumeration), inactive account 401 |
| `userAccountLockout.spec.js` | 3 | *Gap closure:* 5 consecutive failures lock the account (6th attempt with the CORRECT password → 423, lock window not extended); expired lock restarts the counter at 1; successful login clears the counter |
| `passwordResetConsumption.spec.js` | 7 | *Gap closure:* valid token swaps the password (hash verified, old password dead, token cleared, new password logs in); unknown token 400; expired token 400; weak new password 400 (nothing changed); missing fields 400 |
| `adminAuthentication.spec.js` | 7 | *Gap closure:* `POST /api/user/admin` issues a `{email, role:'admin', type:'admin'}` JWT for the env-configured credentials; wrong password/email and shopper credentials 401; missing password 400; the issued token passes `authAdmin` on `GET /api/orders/all` while a shopper token gets 403 |
| `productCatalogReads.spec.js` | 12 | *Gap closure:* public list pagination metadata + `date` desc sorting; category / bestseller / inStock filters; case-insensitive name+description search; empty result page; single product by id / 404 unknown / 400 malformed / 400 missing; pins as-built "public reads create NO analytics docs" (no auth middleware → no user context) |
| `userAddressBook.spec.js` | 9 | *Gap closure:* all 5 address routes 401 unauthenticated (nothing written); add / list / edit (partial update) / set-default / delete semantics on the embedded user addresses; cross-user edit → 404 with the owner's doc untouched; pins as-built "first address is NOT auto-defaulted unless the client flags it" |
| `paypalOrderCreate.spec.js` | 6 | *Gap closure:* `POST /api/orders/paypal/create` persists a pending PayPal order (amount math, `paypalOrderId`, user history link) and returns the approve link; the captured network-edge request is STRICT-USD CAPTURE with correct breakdown; 401/400 guards; PayPal currency error → 400 `CURRENCY_NOT_SUPPORTED`, generic outage → 500 `PAYPAL_UNAVAILABLE`, nothing persisted on failure |
| `analyticsAggregation.spec.js` | 10 | *Gap closure:* 401/403 on admin reads; `track-activity` persists a user-attributed doc (200) and rejects admin tokens (400); sales aggregation counts only completed+active orders in-window (summary, daily bucket, payment breakdown, status breakdown incl. pending); product performance ranking + rollups; user-behavior action/active-user rollups; popular searches + search stats; dashboard summary (today/month/totals/recent orders/low stock). **K-12 fixed 2026-10-24:** `categoryBreakdown` aggregates real product categories via the ObjectId-normalized `$lookup` (iPhone $200/1 order/2 units + Mac $50/1/1 from the fixtures), and a robustness case proves a completed order with a non-ObjectId `productId` is skipped (counted in summary, absent from the breakdown) instead of 500ing the report |

## 2. Frontend suite (vitest)

```bash
cd frontend && npm run test -- --run
```

10 files / 38 tests (jsdom + @testing-library/react): ShopContext guard,
Product page, PayPalPayment wrapper, useCart, useWebSocket, BestSeller,
LatestCollection, ProductItems, PlaceOrder checkout wiring (COD/Card submit
`/api/orders`, cart clear, redirect, failure/empty-cart/login guards,
PayPal branch untouched — since the 2026-10-24 K-1 fix — plus the delivery
form's `POST /api/user/addresses` save case from the K-11 fix), and
`AddressBook.test.tsx` (5 specs locking every K-11 mutation URL/method/payload
against the backend contract).

## 2b. Admin suite (vitest — infrastructure added 2026-10-24)

```bash
cd admin && npm run test -- --run
```

The admin panel previously had **zero** test infrastructure. It now runs
vitest 3 + jsdom + @testing-library/react 16 (React 19 compatible), ported
from the storefront's setup (dedicated `vitest.config.ts`, `src/test/setup.ts`
with jest-dom + cleanup + a react-toastify stub):

| File | Tests | Covers |
|---|---|---|
| `src/__tests__/apiTypes.test.ts` | 11 | The shared API-error triage helpers (`getApiErrorMessage`, `getAxiosErrorResponse`, `isNetworkError`) against real `AxiosError` instances — response/network/plain-error/fallback branches |
| `src/__tests__/components/Login.test.tsx` | 5 | Login form posts to `/api/user/admin` with the entered credentials; success stores the token via `setToken`; 401 / 500 / network error each map to their dedicated toast and never store a token; required-field guards |
| `src/__tests__/components/Navbar.test.tsx` | 2 | Management chrome renders; logout clears the token |
| `src/__tests__/pages/dashboard.test.tsx` | 4 | Dashboard fetches `/api/analytics/dashboard-summary` with the stored Bearer token; renders metric cards, month summary, recent orders and low-stock alerts from the response; loading state while in flight; error state on API failure |
| `src/__tests__/pages/orders.test.tsx` | 6 | *Suite extension (2026-10-24):* Orders page GETs `/api/orders/all?page=1&limit=20&sortBy=createdAt&sortOrder=desc` with the token header and renders stats cards/pagination/order cards; the current-status button is disabled; PUTs a status transition to `/api/orders/status` with `{ orderId, status }` then re-fetches; no-token and 401 toasts; loading + empty states |
| `src/__tests__/pages/add.test.tsx` | 4 | *Suite extension (2026-10-24):* Add-product form submits multipart FormData to `/api/product/add` with the exact field encoding (JSON-encoded `bestseller`/`color`, select defaults, `stockQuantity` default, images optional); resets on success; backend field-level validation errors map to per-field toasts; required-field guards |
| `src/__tests__/pages/list.test.tsx` | 7 | *Suite extension (2026-10-24):* List page loads the **public** paginated catalog (`/api/product/list?page=1&limit=20`, no auth header) and renders rows (names render twice — mobile + desktop layouts); pages via the query string; deletes via `POST /api/product/remove` `{ id }` + token header then refreshes; Refresh button re-fetches; error toast + loading + empty states |
| `src/__tests__/pages/salesAnalytics.test.tsx` | 6 | *Suite extension (2026-10-25):* Sales page GETs `/api/analytics/sales?startDate=…&endDate=…` with the stored **Bearer** token (default window = today-30d through today, clock frozen via `toFake: ['Date']` so the default window pins deterministically) and renders summary cards, period line, category / payment / status breakdowns; re-fetches on date change and on Refresh; loading / error / no-data states |
| `src/__tests__/pages/productAnalytics.test.tsx` | 6 | *Suite extension (2026-10-25):* Product page GETs `/api/analytics/products?metric=revenue&limit=10` (no `category` param when unfiltered); filter changes (metric/limit/category) re-fetch with the exact new params (each change re-settles through the loading state first); stats cards + top-product rows (rank, name, `category • subCategory`, price, metric-dependent value); rows with a **null `productId`** (deleted product) are filtered out instead of rendering/crashing; empty / loading / error / no-data states |
| `src/__tests__/pages/userAnalytics.test.tsx` | 5 | *Suite extension (2026-10-25):* User page GETs `/api/analytics/user-behavior?startDate=…&endDate=…` with the Bearer token and renders action-label chips (login → Login), daily trend, most-active users, product interactions (views/add-to-cart/purchases + conversion), summary stats; the optional **userId** filter appends `&userId=` and shows the "Filtered by User ID" badge; date-change re-fetch; loading / error states |
| `src/__tests__/pages/searchAnalytics.test.tsx` | 5 | *Suite extension (2026-10-25):* Search page GETs `/api/analytics/search?startDate=…&endDate=…&limit=10` with the Bearer token and renders stats cards, popular searches (quoted query, results count, category chip), trends, category breakdown, performance metrics (query diversity, searches per query, most popular) and insights; limit-select change re-fetches with `limit=5`; loading / error / no-data states |
| `src/__tests__/components/Sidebar.test.tsx` | 4 | *Suite extension (2026-10-25):* All 8 NavLinks render with the hrefs that match the real `App.tsx` routes (`/dashboard`, `/add`, `/list`, `/orders`, `/analytics/{sales,products,users,search}` — `OrdersIcon`'s embedded `<title>` leaks into the accessible name, absorbed by end-anchored name matchers); NavLink marks exactly the open route active (checked at an analytics route and at `/orders`); pins the as-built quirk that **no** sidebar item highlights on the index route `/` (the Dashboard `Route` targets `/`, the link targets `/dashboard`) |

Admin coverage is now complete for the shipped surface: every page
(dashboard, orders, add, list, the four analytics pages), every chrome
component (Login, Navbar, Sidebar) and the shared API helpers.

## 2c. Storefront E2E (Playwright — real browser, real backend)

```bash
cd frontend && npm run test:e2e
```

This script was previously fictional (K-7); it is now a real suite. The
config (`frontend/playwright.config.ts`) orchestrates the whole stack per
run — no manual setup:

1. **Backend**: `backend/scripts/e2e-server.mjs` boots an in-memory MongoDB
   (cached 7.0.14 binary), seeds the catalog through the real product model,
   spawns `node server.js` with a self-contained e2e env (no real
   credentials anywhere), and waits for `/health/ready`.
2. **Storefront**: the vite dev server on `:5173` (default CORS-allowed
   origin).

`e2e/checkout.spec.ts` (2 specs) then drives **real Chromium** through the
money path: UI registration (form → token in localStorage) → catalog browse
→ product page → color + add-to-cart (server cart sync observed) → cart page
→ delivery form → **COD** / **Card** order → `/orders` redirect → the
persisted order verified through the API with the browser's own token
(method, `pending` payment status, totals). First run downloads the
Playwright Chromium binary (~120 MiB).

**Deliberately not driven here:** the PayPal branch — it needs real sandbox
credentials and a public HTTPS host (owner item, `docs/devops/08`). The
PayPal SDK/approve-link wiring remains covered by mocked-edge backend specs
(`paypalOrderCreate`, `captureEndpointVerification`, `paypalWebhook`,
`webhookIdempotency`, `webhookUnmatchedCapture`) and the
`PayPalPayment.test.tsx` component wrapper.

## 3. Command truth table (⚠️ read before running anything)

| Command | Truth |
|---|---|
| `cd backend && npm run test:security` | ✅ The regression suite (canonical) |
| `cd backend && node --experimental-vm-modules node_modules/.bin/jest --runInBand` | ✅ Same thing, spelled out (plain `npx jest` **fails** on ESM spec imports — expected) |
| `cd backend && npm test` | ⚠️ Runs `scripts/run-tests.js` — needs a **live MongoDB + SMTP + env**; it is NOT the regression suite (a harness with ephemeral infra exists in the Phase 1 record) |
| `cd backend && npm run lint` / `build` | ✅ lint clean · `build` is a placeholder echo (no compile step — pre-existing) |
| `cd frontend && npm run lint` / `type-check` / `test -- --run` / `build` | ✅ All pass (PWA precache emitted) |
| `cd frontend && npm run test:e2e` | ✅ **Real since 2026-10-24** — Playwright vs the orchestrated real stack (§2c); first run downloads the Chromium binary |
| `cd frontend && npm run test:e2e:ui` | ⚠️ Playwright UI mode — needs a display; use plain `test:e2e` headless |
| `cd admin && npm run lint` / `build` / `type-check` | ✅ All clean (`type-check` added 2026-10-25, K-7 fix) |
| `cd admin && npm run test -- --run` | ✅ Real since 2026-10-24 (vitest, 13 files / 70 tests — incl. the K-6 MobileNav/NotFound suites); bare `npm test` starts **watch mode** |
| `cd backend && npm run db:seed` / `db:migrate` / `email:test` | ✅ Fixed 2026-10-25 (K-7): point at the real `seedCategories.js` / `migrateOrders.js` / `test-email.js` (SMTP verify; needs SMTP env; sends only with `TEST_EMAIL_TO`) |
| `cd backend && npm install` | ✅ postinstall no-op removed 2026-10-25 (patch-package had no `patches/` dir) |

## 4. Feature ↔ code ↔ test traceability matrix

Legend: ✅ covered by passing automated tests · 🧪 manual-only · 🟡 partial ·
⛔ gap. (Updated 2026-10-24 by the test-gap closure pass — every closable ⛔
row is now ✅/🟡.)

| Feature (PRD ref) | Primary code | Automated coverage |
|---|---|---|
| User registration/login | `userController.loginUser/registerUser` | ✅ `userAuthRegistrationLogin` (8) |
| Account lockout | `userModel` lock methods + `isLocked` | ✅ `userAccountLockout` (3) |
| Password reset — send | `userController.requestPasswordReset` | ✅ `passwordResetEmail` (3) |
| Password reset — consumption | `userController.resetPassword` | ✅ `passwordResetConsumption` (7) |
| Admin login | `userController.adminLogin` | ✅ `adminAuthentication` (7) |
| Cart CRUD + ownership (IDOR closure) | `cartController`, `routes/cartRoute.js` | ✅ `cartCategoryAddressAuthorization` (13) |
| Product list/search/single | `productController` | ✅ `productCatalogReads` (12) backend + frontend vitest rendering |
| Product add/remove (admin) | `productController`, `routes/productRoute.js` | ✅ authz paths in `adminAuthorization`/`cartCategoryAddress`; image upload path 🧪 (Cloudinary edge) |
| Category CRUD + guards | `categoryController`, `routes/categoryRoute.js` | ✅ `cartCategoryAddressAuthorization` |
| Address book CRUD (backend + frontend wiring) | `userController` address handlers; `AddressBook.tsx`, `PlaceOrder.tsx` | ✅ `userAddressBook` (9) backend; frontend mutation URLs/methods/payloads locked by `AddressBook.test.tsx` (5) + a `PlaceOrder.test.tsx` case (K-11 fixed) |
| COD/Card order placement (API) | `orderController.placeOrder` | ✅ `orderPaymentMethods` (7) + real 27/27 smoke; storefront wiring via `PlaceOrder.test.tsx` |
| PayPal order create | `placeOrderPayPal` | ✅ `paypalOrderCreate` (6) |
| PayPal capture + verification gates | `capturePayPalPayment` | ✅ `captureEndpointVerification` (4) |
| PayPal webhook signature (fail-closed) | `paypalWebhookService`, `handlePayPalWebhook` | ✅ `paypalWebhook` (6) |
| Webhook idempotency state machine | `handlePayPalWebhook`, `webhookEventModel` | ✅ `webhookIdempotency` (9) |
| Unmatched-capture recovery + reconciliation | `processCaptureCompletedEvent` | ✅ `webhookUnmatchedCapture` (8) |
| Admin order status update (whitelist) | `updateStatus`, `ORDER_STATUSES` | ✅ `adminAuthorization` |
| Realtime order events | `socketService` | ✅ null-safe emitters via shutdown specs; end-to-end socket flow 🧪 |
| Analytics tracking + admin reads | controllers inline + `analyticsController` | ✅ `analyticsAggregation` (10) — `categoryBreakdown` asserts real categories since the K-12 fix, incl. the garbage-id robustness case |
| Health endpoints | `app.js` | ✅ `healthEndpoints` (8) |
| Graceful shutdown lifecycle | `shutdownManager`, `server.js` | ✅ `gracefulShutdown` (12) + integration (2) |
| Startup guardrails | `startupValidation`, `server.js` wiring | ✅ `startupValidation` (13) |
| Log redaction | `utils/redact.js`, error handler | ✅ `loggingRedaction` (17) |
| Storefront cart context | `frontend/src/context`, `useCart` | ✅ frontend vitest |
| Storefront PayPal button wrapper | `PayPalPayment.tsx` | ✅ frontend vitest (wrapper only — not the money flow) |
| Storefront WebSocket client | `useWebSocket` | ✅ frontend vitest |
| Checkout end-to-end (browser → order) | `PlaceOrder.tsx` flows | ✅ component-level `PlaceOrder.test.tsx` + **real-browser E2E** `e2e/checkout.spec.ts` (COD + Card, 2 specs, real backend + real DB); PayPal-branch E2E open (needs sandbox creds — `docs/devops/08`) |
| Admin panel — pages, analytics, chrome | `admin/src` | ✅ `apiTypes` (11) + `Login` (5) + `Navbar` (2) + `dashboard` (4) + `orders` (6) + `add` (4) + `list` (7) + the four analytics pages (sales 6 / product 6 / user 5 / search 5) + `Sidebar` (4) — fetch contracts incl. Bearer auth + default 30-day windows, filter re-fetches, render/error/loading/empty states, deleted-product row filtering, nav↔route parity + active highlighting |
| Live PayPal (sandbox or live) | — | ❓ UNVERIFIED — mocks only at HTTP edge; run `docs/devops/08` checklist |

## 5. Coverage gaps & priorities (honest list — updated 2026-10-25)

Closed by the 2026-10-24 test-gap pass: user auth (register/login/lockout),
reset consumption, admin login, product reads, address book backend, PayPal
order create, analytics aggregations, admin test infrastructure (starter),
real-browser COD/Card checkout E2E. Closed by the follow-up pass the same
day: the K-11 and K-12 fixes (each with locking specs) and the admin
Orders/Add/List page suites. Closed by the 2026-10-25 pass: the admin
analytics pages (sales/product/user/search) and the Sidebar — the admin
panel's shipped surface is now fully covered (12 files / 65 tests). What
honestly remains:

1. **Live PayPal validation** (owner action) — everything mocked is exactly
   as good as the mocks; the sandbox checklist stays ❓ UNVERIFIED until
   executed against a staging host. This now also covers driving the
   PayPal **branch** of checkout E2E (SDK render, approve redirect, capture)
   which needs the same sandbox credentials.
2. **Realtime socket flow** — still manual-only (null-safe emitters are
   covered by the shutdown specs); a socket.io-client spec against the real
   server would be the next increment.

## 6. How to add tests (project conventions)

- Backend: new spec in `backend/__tests__/`, ESM imports, build fixtures via
  `helpers.mjs` (real models, in-memory Mongo), mock **only** network edges
  (follow `setPayPalClientForTests` / `setActiveWebhookVerifier` seams), run
  with the canonical command in §1. Do not use `npm test` for regression.
  ⚠️ **authLimiter budget:** every `/api/user/*` route shares a 20-request /
  15-minute / IP limiter and jest gives each spec file a fresh app instance —
  keep each spec file's `/api/user/*` request count under 20 (existing specs
  note their counts in the header) or later requests start returning 429.
  ⚠️ Login-flow fixtures must carry a REAL bcrypt hash — use
  `createLoginUserDoc` (`helpers.mjs`); the plain `createTestUserDoc` stores
  the fixture password as-is (fine for token-only fixtures, useless for
  `bcrypt.compare`).
- Frontend: add under `src/__tests__/` mirroring the path; jsdom +
  testing-library patterns are established in the 9 existing files.
- Admin: mirror `src/__tests__/` in `admin/` (setup ported in
  `admin/src/test/setup.ts`); run with `npm run test -- --run`.
  ⚠️ **Analytics-page conventions (learned 2026-10-25):** the four analytics
  pages call `fetch` (not axios) with `Authorization: Bearer` + the token
  from `localStorage` — stub with `vi.stubGlobal('fetch', …)`; freeze the
  clock with `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(…)`
  so the default 30-day window (`today-30d` … `today`) pins deterministically
  while RTL's real polling timers keep working; every filter change flips
  the page back into its loading branch, so `await
  screen.findByText(<settled heading>)` between interactions; period lines
  render dates as bare text nodes (`<p><strong>Period:</strong> {a} to {b}</p>`)
  — match the joined paragraph text with a function matcher pinned to
  `tagName === 'P'` (the wrapper div carries the same textContent);
  `OrdersIcon`'s embedded `<title>order-history</title>` leaks into NavLink
  accessible names — use end-anchored regex name matchers.
- E2E: new spec in `frontend/e2e/`; the config boots the whole stack — do
  not add real credentials, and keep PayPal-branch flows out until sandbox
  creds exist (`docs/devops/08`).
- Any new webhook behavior must extend the state-machine specs — the
  regression these tests encode (falsely acknowledged retries) was a real
  production-class bug.
