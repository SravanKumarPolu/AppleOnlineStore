# NovaCart — Product Requirements Document (PRD, As-Built)

> **Status:** Reflects the repository as implemented on 2026-10-24 (post Phase 1
> Final Security & Reliability Gate, webhook unmatched-capture fix, and
> pre-production readiness work). This document describes **what actually
> exists in the code** — nothing aspirational is stated without a status label.
>
> **Traceability chain:** PRD (this file) → [02-APP_FLOWS.md](./02-APP_FLOWS.md)
> → [03-TECH_ARCHITECTURE.md](./03-TECH_ARCHITECTURE.md)
> → [04-DATABASE_SCHEMA.md](./04-DATABASE_SCHEMA.md)
> → [05-API_REFERENCE.md](./05-API_REFERENCE.md)
> → [06-DEPLOYMENT.md](./06-DEPLOYMENT.md)
> → [07-TESTING_PLAN.md](./07-TESTING_PLAN.md) (feature↔code↔test matrix)
> → [08-SECURITY.md](./08-SECURITY.md) → [09-OPERATIONS.md](./09-OPERATIONS.md)

## 1. Product overview

NovaCart is a full-stack e-commerce system for a consumer-electronics catalog
(iPhone, iPad, Mac, Watch, AirPods, Accessories), composed of three
applications backed by one API:

| Application | Package | Role |
|---|---|---|
| Storefront | `frontend/` | Customer-facing PWA: catalog, search, product detail, cart, checkout, order tracking |
| Admin panel | `admin/` | Operator dashboard: login, product add/remove, order fulfillment, analytics |
| Backend API | `backend/` | Node/Express REST API + Socket.IO realtime + PayPal integration + email |

External services: MongoDB (Atlas or self-hosted), PayPal REST API (sandbox or
live), Cloudinary (product image hosting), SMTP (transactional email).

### 1.1 Naming (official convention)

The official product name is **NovaCart**. Historical/alternate names that
appear in the codebase and must not be used in new material:

- `SKR E-Commerce` / `SKR Store` — storefront PWA manifest and root README
  (legacy template branding)
- `Apple Store` / `Apple` — storefront page copy, logo glyph, and product
  catalog heritage
- `E-commerce Store` — the backend email `APP_NAME` default and
  `backend/env.example` value
- `AppleOnlineStore` — earlier project name (historical references only)

Package names are generic (`backend`, `frontend`, `admin`). New documentation,
commit messages, and user-facing copy should use **NovaCart**.

## 2. Status label legend

Every feature below carries exactly one label:

| Label | Meaning |
|---|---|
| **✅ Implemented** | Working in the current code, covered or verifiable |
| **🟡 Partial** | Exists but incomplete, unwired, or with known defects |
| **📋 Planned** | Not in the code; agreed roadmap item |
| **⛔ Blocked** | Cannot proceed without owner/external action |
| **❓ UNVERIFIED** | Implemented but not validated end-to-end outside mocks |
| **🪦 Deprecated** | Dead code kept in the tree; do not build on it |

## 3. Users and roles

| Role | How identified | Where they operate |
|---|---|---|
| Shopper | DB user account; JWT (7 d, payload `{id}`) | `frontend/` storefront |
| Admin | Env credentials (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); JWT (1 d, payload `{email, role:'admin', type:'admin'}`) — or a DB user with `role:'admin'` | `admin/` dashboard |
| System (PayPal) | Webhook signature verification (fail-closed) | `backend` webhook endpoint |

There is no separate registration flow for admins; admin identity is
environment-based (a known limitation — see [08-SECURITY.md](./08-SECURITY.md)).

## 4. Feature catalog

### 4.1 Catalog & discovery

| Feature | Status | Notes / evidence |
|---|---|---|
| Product listing with pagination | ✅ Implemented | `GET /api/product/list` (page/limit/filters/search); defaults 10/page |
| Keyword search (name + description, case-insensitive) | ✅ Implemented | Regex `$or` query in `productController.listProducts` |
| Category / subcategory filtering | ✅ Implemented | Query params on product list |
| In-stock / bestseller filters | ✅ Implemented | Query params on product list |
| Category navigation from DB categories | ✅ Implemented | `Category` collection + `GET /api/category/list` (public) |
| Related products on product detail | ✅ Implemented | `RelatedProducts.tsx` (same category query) |
| Bestsellers & latest-collections sections | ✅ Implemented | `BestSeller.tsx`, `LatestCollection.tsx` |
| Product ratings display | 🟡 Partial | `ratings {average, count}` exists on the product schema, but **no rating/review submission flow exists** — values default to 0 unless set manually in the DB |
| Featured flag | 🪦 Deprecated | Schema field exists; no consumer filters on it |

### 4.2 Accounts & authentication

| Feature | Status | Notes / evidence |
|---|---|---|
| Registration (name/email/password, strength rules) | ✅ Implemented | `POST /api/user/register`; bcrypt 12 rounds; letters-only name; uppercase+lowercase+digit+special password |
| Login with account lockout | ✅ Implemented | 5 failed attempts → 2 h lock (423 response) |
| JWT token auth (7 d) | ✅ Implemented | Sent as custom `token` header by the storefront |
| Password reset by email | ✅ Implemented | Full flow (`forgot-password` → token → `reset-password`, 1 h hashed token); the reset email renders correctly after the K-4 argument-order fix (2026-10-24, see §5) |
| Welcome email on registration | ✅ Implemented | Non-blocking send; failure only logs |
| Social login (Google/Facebook buttons) | 🪦 Deprecated | Buttons render on Login page but are **not wired**; `socialAuthService.js` is dead code (imports non-existent models); `ENABLE_SOCIAL_LOGIN` is read only by that dead service, never at runtime |
| 2FA / biometric fields | 🪦 Deprecated | `twoFactorSecret`, `biometricEnabled` etc. exist on the user schema; no code path reads or writes them beyond schema defaults (frontend has an unwired demo) |
| Profile view | ✅ Implemented | `GET /api/user/profile` |
| Profile edit | 🟡 Partial | `PUT /api/user/profile` works (name/email), but the storefront Profile page has a TODO stub for edits |
| Session expiry / auto-logout | 🟡 Partial | Frontend never checks token expiry; no 401 interceptor — expired tokens surface as failing calls |

### 4.3 Address book

| Feature | Status | Notes / evidence |
|---|---|---|
| Address CRUD on user document | ✅ Implemented | Backend routes (`POST/GET /api/user/addresses`, `PUT /api/user/addresses/default`, `PUT/DELETE /api/user/addresses/:addressId` — addresses are **embedded subdocuments of `users`**); every frontend caller now uses the routed plural endpoints (K-11 fixed 2026-10-24, locked by `AddressBook.test.tsx` + `PlaceOrder.test.tsx` + backend `userAddressBook.spec.js`) |
| Default address selection | ✅ Implemented | Explicit `default:true` wins and demotes the rest; set-default endpoint switches it later. As-built: a first address is **not** auto-defaulted unless the client flags it (pinned in `userAddressBook.spec.js`) |
| Standalone address collection save | 🪦 Deprecated | `POST /api/address/save` writes the `addresses` collection; **no frontend caller** — dead endpoint (kept for compatibility) |

### 4.4 Cart

| Feature | Status | Notes / evidence |
|---|---|---|
| Cart with color-level quantities | ✅ Implemented | `users.cartData` shape `{productId: {color: qty}}`; color is chosen at add-to-cart |
| Guest cart (localStorage) | ✅ Implemented | Key `cartItems`; merged to server on login via `POST /api/cart/sync-local` |
| Server cart sync & mutations | ✅ Implemented | `/api/cart/add`, `/api/cart/update`, `/api/cart/get`, `/api/cart/sync-local` — all `authUser`-guarded, ownership derived from token (IDOR closed in Phase 1) |
| Cart analytics tracking | ✅ Implemented | add/remove events write `UserActivity` + `ProductPerformance` |
| Size selection | — Not built | Products carry colors only; no size dimension anywhere in schema or UI |

### 4.5 Checkout & payment

| Feature | Status | Notes / evidence |
|---|---|---|
| PayPal checkout (create → approve → capture) | ✅ Implemented | `POST /api/orders/paypal/create` → PayPal JS SDK approval → `POST /api/orders/paypal/capture`; USD only |
| PayPal webhook confirmation (async) | ✅ Implemented | `PAYMENT.CAPTURE.COMPLETED` with fail-closed signature verification, idempotency state machine, bounded retry for unmatched captures, delayed-order reconciliation |
| Payment verification gates | ✅ Implemented | Capture identity / amount (cents) / currency verified before any order write; refunded orders never clobbered |
| COD (cash on delivery) checkout | ✅ Implemented | COD submits a real order via `POST /api/orders` (`paymentMethod:'COD'`, `paymentStatus:'pending'`), clears the cart and redirects to Orders (K-1 fixed 2026-10-24; covered by `orderPaymentMethods.spec.js`, `PlaceOrder.test.tsx` and the live 27/27 smoke) |
| Card / “stripe” checkout | 🟡 Partial | Order creation is real since the K-1 fix: the UI maps the “stripe” method to `paymentMethod:'Card'` (schema enum `COD/PayPal/Card`), creating a `paymentStatus:'pending'` order whose card payment the store arranges/collects manually. **No online card gateway is integrated** — the button is not a card payment, it is a recorded intent |
| PayPal client ID configuration | ✅ Implemented | `PlaceOrder.tsx` reads `import.meta.env.VITE_PAYPAL_CLIENT_ID || ""` — no fallback literal (K-2 fixed 2026-10-25); unset renders an explicit “PayPal payments are unavailable” state |
| Currency | — USD only | Hardcoded in frontend display, order creation (`currency:'USD'`), and PayPal intent; multi-currency is not built |
| Shipping fee | ✅ Implemented | Fixed $10 per order (orderController + order schema default) |
| Stock decrement on order | ✅ Implemented | Atomic reservation (`stockQuantity >= qty` + `$inc`) at checkout; insufficient stock is rejected 400 and partial reservations roll back (K-5 fixed 2026-10-25). Restoration on cancel/refund/expiry is exactly-once via the product-side ledger (K-13) |

### 4.6 Orders & tracking

| Feature | Status | Notes / evidence |
|---|---|---|
| Order placement (PayPal path) | ✅ Implemented | Creates order, clears server cart, pushes to `user.orders`, realtime notifications |
| Order history page | ✅ Implemented | `Orders.tsx` + `POST /api/orders/userorders` |
| Realtime order status updates | ✅ Implemented | Authenticated Socket.IO rooms `user_<id>` / `order_<id>` / `admin_room`; minimal `order_updated` and `new_order` events (payment changes use the `payment_update` discriminator) |
| Typing indicators in order room | 🟡 Partial | Backend relays `user_typing`/`user_stop_typing`; the frontend WebSocket context only console-logs these events |
| Order status lifecycle (admin-driven) | ✅ Implemented | 6 statuses: Order Placed → Packing → Shipped → Out for delivery → Delivered (or Cancelled); server-side enum whitelist |
| Payment status lifecycle | ✅ Implemented | `pending` → `completed` (verified capture/webhook) · `failed` · `refunded`. Refunds are an admin API action with a separate `refundStatus`: `pending` (requested, not confirmed — order stays `completed`) → `completed` (money returned, `paymentStatus:'refunded'`, inventory released) or `failed` (definitive provider rejection, retryable). COD/Card refunds are recorded as `manual`. No customer-facing refund UI |
| Tracking number / estimated delivery fields | 🪦 Deprecated | Schema fields exist; no UI or API writes them |

### 4.7 Admin panel

| Feature | Status | Notes / evidence |
|---|---|---|
| Admin login (env credentials) | ✅ Implemented | `POST /api/user/admin` → 1 d admin JWT |
| Product add (4 images, colors, stock, bestseller) | ✅ Implemented | Multipart upload → Cloudinary; 10 hardcoded color options; categories iPhone/iPad/Mac/Watch/AirPods/Accessories |
| Product list + delete (paginated) | ✅ Implemented | 20/page |
| Product edit | — Not built | No edit route or page exists |
| Order management (filter by status, advance status) | ✅ Implemented | Statuses driven by server-provided `filters.orderStatuses` |
| PayPal transaction ID display | ✅ Implemented | Shown on admin order cards |
| Dashboard summary + sales/product/user/search analytics | ✅ Implemented | Live aggregation from orders/analytics collections; stat cards and lists (**no chart library**) |
| Category & subcategory management | ✅ Implemented (API) / 🟡 Partial (UI) | 7 admin-guarded API routes exist; the admin panel has **no category UI** (the unrouted `AdminCategories.tsx` page in the storefront is the only consumer) |
| Mobile usability | 🟡 Partial | Sidebar hidden below `lg` breakpoint with no drawer — admin nav unusable on small screens |
| Session handling | 🟡 Partial | Token in localStorage; no expiry handling or 401 auto-logout; inconsistent auth header styles across pages (`token` header vs `Authorization: Bearer`) |

### 4.8 Analytics (platform)

| Feature | Status | Notes / evidence |
|---|---|---|
| Activity tracking (view/search/cart/purchase) | ✅ Implemented | Written inline by product/cart/order controllers + `POST /api/analytics/track-activity` |
| Product performance metrics | ✅ Implemented | Views / add-to-cart / purchases / revenue per product |
| Search analytics | ✅ Implemented | Query counts + result counts |
| Admin analytics reads | ✅ Implemented | `dashboard-summary`, `sales`, `products`, `user-behavior`, `search` (admin-guarded) |
| Pre-aggregated daily sales documents | 🪦 Deprecated | `SalesAnalytics` model exists but **no runtime code writes it** (only a dev script populates activity); the sales endpoint aggregates live from orders instead |
| Analytics service layer | 🪦 Deprecated | `services/analyticsService.js` is dead (CJS `require()` in an ESM package, non-existent model paths, zero importers) |
| `ENABLE_ANALYTICS` flag | 🪦 Deprecated | Documented in `env.example`; read only by the dead `analyticsService.js`, never at runtime |

### 4.9 Email

| Feature | Status | Notes / evidence |
|---|---|---|
| SMTP email service | ✅ Implemented | nodemailer; `APP_NAME` default `E-commerce Store` |
| Welcome email | ✅ Implemented | Wired to registration |
| Password reset email | ✅ Implemented | Wired and renders correctly (greeting by name, working `FRONTEND_URL`-based reset link) after the K-4 fix |
| Order confirmation / status update / low-stock alert / security alert templates | 🪦 Deprecated | Six template methods exist in `emailService.js`; **orderConfirmation, orderStatusUpdate, lowStockAlert, and securityAlert are never called** by live code |

### 4.10 PWA (storefront)

| Feature | Status | Notes / evidence |
|---|---|---|
| Installable PWA (manifest + service worker) | ✅ Implemented | vite-plugin-pwa, `autoUpdate`; static `public/manifest.json` |
| Runtime caching (fonts, PayPal, Cloudinary) | ✅ Implemented | Workbox runtime caching config |
| Offline overlay page | ✅ Implemented | `OfflinePage.tsx` |
| Install prompt + guide | ✅ Implemented | `PWAInstallGuide`, install-prompt component |
| Push notifications / background sync | — Not built | No push or background-sync code exists (older README claims to the contrary are template text) |
| PWA icon completeness | 🟡 Partial | `apple-touch-icon.png` and manifest screenshots are referenced but missing from `public/` |

### 4.11 Non-functional (as-built)

| Property | Status | Notes |
|---|---|---|
| Security hardening (helmet/CSP, CORS allowlist, rate limits, mongo-sanitize, validation) | ✅ Implemented | See [08-SECURITY.md](./08-SECURITY.md) |
| Graceful shutdown with bounded lifecycle | ✅ Implemented | See [09-OPERATIONS.md](./09-OPERATIONS.md) |
| Health endpoints (live/ready/legacy) | ✅ Implemented | |
| Startup configuration guardrails | ✅ Implemented | Fail-fast on live-PayPal-with-placeholder creds; prod-without-JWT_SECRET |
| Log redaction (secrets never logged) | ✅ Implemented | Canary-tested |
| Automated tests | ✅ Implemented (backend 42 suites/416 · storefront 24 files/125 · admin 13 files/70 · storefront E2E 3 spec files/17 tests × 3 engines = 51, incl. COD+Card checkout and axe a11y — verified by execution 2026-10-26) | See [07-TESTING_PLAN.md](./07-TESTING_PLAN.md) and [docs/10-FINAL-STABILIZATION-REPORT.md](./10-FINAL-STABILIZATION-REPORT.md) |
| Docker / CI/CD / IaC | 📋 Planned | No infrastructure files in the repo; see [06-DEPLOYMENT.md](./06-DEPLOYMENT.md) |
| Monitoring / alerting / log aggregation | 📋 Planned | Phase 8 of the DevOps roadmap |
| Accessibility (a11y) | 🟡 Partial | **Automated axe scans pass** on the core screens across Chromium/Firefox/WebKit (part of the 51 E2E checks). Manual screen-reader / 200 %-zoom acceptance **not yet executed** — per-screen checklist: [07-TESTING_PLAN.md](./07-TESTING_PLAN.md) §7 |
| Performance budgets | 🟡 Partial | Local load harness with committed artifacts (`docs/testing/load-results-2026-10-26-post-fix.json`); **no Lighthouse budget run**, and staging capacity is unmeasured — plan: [07-TESTING_PLAN.md](./07-TESTING_PLAN.md) §8 |
| SEO metadata & discoverability | 🟡 Partial | Title/description/OG/Twitter + `robots.txt` are NovaCart-branded and valid (2026-10-26); canonical URL, `og:image`, `sitemap.xml` are **deferred pending the production domain** (owner input — placeholders would be wrong); SPA — no SSR/prerendering, so crawlability relies on the PWA shell + correct metadata |

## 5. Known defects & gaps (documented, not hidden)

| ID | Severity | Summary |
|---|---|---|
| K-1 | High | ~~**COD and Card checkout place no order.**~~ **FIXED 2026-10-24** (approved): `PlaceOrder.tsx` now submits COD/Card through `POST /api/orders`; backend enum extended with `'Card'` and non-whitelisted methods get an explicit 400. Regression: backend 13 suites/111 tests, frontend 9 files/32 tests, live 27/27 smoke — all green. |
| K-2 | High | ~~**PayPal sandbox client ID hardcoded as fallback** in `PlaceOrder.tsx`; a build without `VITE_PAYPAL_CLIENT_ID` silently points at the wrong PayPal app.~~ **FIXED 2026-10-25**: the fallback is gone — `const paypalClientId = import.meta.env.VITE_PAYPAL_CLIENT_ID || ""` and an empty id renders an explicit "PayPal payments are unavailable" state. Still an owner action to set the variable in production. |
| K-3 | High | **Git history holds live credentials** (owner's canonical repo: dangling `backend/.env` commit + a pushed admin password; this working copy verified clean). 🟡 `JWT_SECRET` + `ADMIN_PASSWORD` rotated and live-verified 2026-10-24 (docs/devops/09); provider rotations + history purge remain owner actions. **The local-hygiene half is fixed 2026-10-26**: no repository-root `.gitignore` existed and `backend/.env` was NOT ignored, so a real local secrets file could be committed — see `docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md` §9. **2026-10-26 second finding:** a distributed ZIP built from the working directory included the ignored populated `backend/.env`; `verify-distribution.mjs` now gates archive contents, and every credential in that archive is ROTATION REQUIRED (`docs/10` §16.1, `docs/devops/07`). |
| K-4 | Medium | ~~**Password-reset email argument-order bug**~~ **FIXED 2026-10-24** (approved): `userController` now calls `sendPasswordResetEmail(email, user.name, resetToken)`; the service gained a `FRONTEND_URL` fallback so links are never `undefined/…`. Covered by `passwordResetEmail.spec.js` (call contract + rendered email). |
| K-5 | Medium | ~~**Placing an order does not decrement stock** and orders are not rejected for insufficient stock.~~ **FIXED 2026-10-25**: atomic reservation (`stockQuantity >= qty` filter + `$inc`), oversell floor 0, rollback on failure, and cancellation restore guarded by `stockReserved`. Locked by `inventoryPricingIntegrity` + `concurrencyRaceConditions`. |
| K-6 | Medium | ~~**Admin panel has no 404 route and no mobile navigation.**~~ **FIXED 2026-10-24/25**: `admin/src/App.tsx` routes `path="*"` → `NotFound` and renders `MobileNav`; covered by the MobileNav/NotFound suites (admin gate 13 files / 70 tests). |
| K-7 | Low | ~~**Broken npm scripts.**~~ **FIXED 2026-10-25 + 2026-10-26**: `db:seed`/`db:migrate`/`email:test` point at real scripts, admin has `type-check`, the no-op `postinstall` is gone, and the 2026-10-26 pass removed the dead `test:unit`/`test:integration`/`test:e2e` patterns, added the ESM flag to `test:coverage`/`test:parallel`, made `security:audit` non-mutating and replaced the backend `build` echo with a real syntax check (`scripts/check-syntax.mjs`). |
| K-8 | Low | ~~**Aspirational env templates**: `backend/env.example` documents ~60 variables no live code reads; only 26 are real.~~ **FIXED 2026-10-25 + 2026-10-26**: the legacy `env.example` files carry a supersession header, and the authoritative `backend/.env.example` / `frontend/.env.example` / `admin/.env.example` now exist with the code-verified variable set (30 / 2 / 1 — the templates that the legacy headers pointed at were missing until 2026-10-26). |
| K-9 | Low | ~~**Duplicate auth stacks**: `authMiddleware.js`/`adminAuth.js` duplicates.~~ **FIXED 2026-10-25**: `middleware/auth.js` exports `authUser`/`authAdmin` (+ default) and is the only auth stack; both duplicate files are deleted. |
| K-10 | Low | ~~**~25 unused heavyweight backend dependencies** inflate the tree and the audit surface.~~ **FIXED 2026-10-25**: 52 dead declarations removed, `axios` dropped from backend + frontend (admin still uses it); `node scripts/audit-deps-usage.mjs` reports 17 prod deps, 0 unused (re-verified 2026-10-26). |
| K-11 | Medium | ~~**All frontend address mutations 404.**~~ **FIXED 2026-10-24** (approved): `AddressBook.tsx` (add/edit/delete/set-default) and the `PlaceOrder.tsx` delivery form now call the routed plural endpoints — add `POST /api/user/addresses`, edit `PUT /api/user/addresses/:addressId` (fields only, id in the route param), delete `DELETE /api/user/addresses/:addressId`, set-default `PUT /api/user/addresses/default`. Locked by `AddressBook.test.tsx` (5) + a `PlaceOrder.test.tsx` case; backend contract pinned by `userAddressBook.spec.js`. |
| K-12 | Low | ~~**Sales-analytics `categoryBreakdown` is always empty.**~~ **FIXED 2026-10-24** (approved): `getSalesAnalytics`'s aggregation now normalizes `items.productId` (string) to an ObjectId via `$convert` (onError/onNull null) before the `$lookup` against `products._id`, so the category breakdown aggregates real product categories; garbage/legacy ids are skipped instead of failing the report. Locked by `analyticsAggregation.spec.js` (10 tests incl. the robustness case). The admin Sales page now renders real category rows. |
| K-13 | High | ~~**A failed stock restoration was silently lost forever.**~~ **FIXED 2026-10-26**: release cleared `stockReserved` and then credited each product on a best-effort basis, logging (not retrying) a failed `updateOne`; a crash between claim and credit lost the units the same way. Restoration is now a durable obligation: `inventoryRestoration.status` (`pending`/`completed`/`reconciliation_required`), a per-item `items[].stockRestored` marker set only after a successful credit, and a sweep that retries owed restorations at boot and every 5 minutes with a structured alert. Locked by `reservationExpiry.spec.js` (failed credit recovered, multi-item at-most-once, deleted product). |
| K-14 | High | ~~**Refunds could be issued twice and a PENDING refund was recorded as completed.**~~ **FIXED 2026-10-26**: the refund intent is claimed atomically **before** the gateway call (no duplicate PayPal refund on concurrent/retried requests); `refundStatus` separates “requested” from “money returned”; `PENDING` returns 202 and stays `pending`; an indeterminate timeout stays reconcilable and blocks blind retries; `PAYMENT.CAPTURE.REFUNDED` webhooks reconcile pending refunds (amount+currency verified). Inventory is released only on completion. Locked by `refundWorkflow.spec.js` (15 tests incl. concurrency, timeout, webhook reconciliation). |
| K-15 | High | ~~**A late PayPal capture could resurrect a cancelled order** (stock already returned) by writing `paymentStatus:'completed'` and `orderStatus:'Order Placed'` unconditionally.~~ **FIXED 2026-10-26**: the capture endpoint now refuses a cancelled/refunded order before calling PayPal (`409 ORDER_NOT_PAYABLE`) and re-checks the state atomically in the write (`409 CAPTURE_REQUIRES_RECONCILIATION`), recording the capture id for refund and raising an ops alert instead of marking the order paid. Locked by `reservationExpiry.spec.js` (pre-flight + in-flight race). |
| K-16 | Medium | ~~**Socket.IO order rooms had no ownership check**, and populated `userId` objects produced the room key `user_[object Object]`, silently dropping shopper updates.~~ **FIXED 2026-10-26**: `join_order_room` verifies the order belongs to the authenticated shopper (admins by role) before joining; typing relays require a joined room; the personal-room key derives from `userId._id` when populated; disconnecting one tab no longer unregisters a user with another tab open. Locked by `socketRealtime.spec.js` (intruder refused, populated update delivered, two-tab disconnect). |
| K-17 | High | ~~**Creation-time reservation was not crash-safe**: `placeOrder` and `/api/orders/paypal/create` decremented `stockQuantity` **before** inserting the order, so a process death in that gap destroyed units with no order to reconcile (the restoration window K-13 was already closed).~~ **FIXED 2026-10-26 (fourth pass)**: the order is inserted as a `stockReservation.status:'pending'` draft first; each line's decrement writes a `<orderId>:<index>` marker in the SAME product update (`reservationDebits`); a successful reservation is committed atomically (`stockReserved:true`, status `reserved`), and every uncommitted draft older than 2 minutes is settled by the sweep (marker-guarded, exactly-once credit, draft removed). Locked by `reservationExpiry.spec.js` — 12 creation-time cases: crash before/after a partial debit/after all debits, committed holds untouched, grace window, two racing sweeps, failed credit retried, ledger hidden, real checkout marker. |

## 6. Explicit non-goals (current state — not built, not promised)

These are frequently assumed but **do not exist** in this system: product
editing, size variants, discount/coupon engine, multi-currency, a
customer-facing refund UI (refunds are an admin API action — `POST
/api/orders/refund`), product reviews submission, social login, push
notifications, background sync, order-detail route in the storefront,
Docker/CI, and any form of session revocation. Adding any of these is new
scope, not a bug fix.

## 7. Related documentation

- Phase 1 engineering records (preserved, authoritative for their scope):
  `docs/devops/01-PHASE1-ARCHITECTURE.md` … `08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`
- Agent-facing repository guide: root `AGENTS.md`
