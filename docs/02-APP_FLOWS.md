# NovaCart — Application Flows (As-Built)

> **Status:** Every flow below was traced through the actual source
> (2026-10-24). Where a flow is a UI stub that does not do what it appears to
> do, that is stated explicitly.
>
> **Chain:** [01-PRD.md](./01-PRD.md) → **this file** →
> [03-TECH_ARCHITECTURE.md](./03-TECH_ARCHITECTURE.md) →
> [04-DATABASE_SCHEMA.md](./04-DATABASE_SCHEMA.md) →
> [05-API_REFERENCE.md](./05-API_REFERENCE.md)

Flow notation: `storefront` = `frontend/`, `admin` = `admin/`, `API` =
`backend/` REST + Socket.IO. Status labels follow the PRD legend.

## 1. Shopper flows (storefront)

### 1.1 Discovery & browsing — ✅ Implemented

1. App boots (`App.tsx`): 12 lazy routes under Suspense; `ShopContext`
   hydrates products via `POST /api/product/list` and categories via
   `GET /api/category/list`.
2. Home page renders hero, latest collections (`date` sort), and bestsellers.
3. Collection page (`Collection.tsx`) applies category/subCategory filters,
   sort, and color chips via product-list query params.
4. Product page (`Product.tsx`): `POST /api/product/single` → product detail;
   related products fetched by same category; server records a
   `view_product` activity + view metric when a token is present.

### 1.2 Search — ✅ Implemented

1. Search bar (debounced, `useDebounce`) → `GET /api/product/list?search=…`.
2. API matches `name`/`description` (case-insensitive regex).
3. With a logged-in user, the search is recorded in `UserActivity`
   (`action:'search'`) and `SearchAnalytics` (query count + result count).
   Analytics failures never fail the product request.

### 1.3 Registration & login — ✅ Implemented

1. `Login.tsx` toggles register/login modes.
2. Register: `POST /api/user/register` (name letters-only 2–50, valid email,
   password ≥ 8 with upper/lower/digit/special). Success → token stored in
   `localStorage['token']`, user object in context; welcome email sent
   async (failure only logged).
3. Login: `POST /api/user/login`. Locked accounts (5 fails → 2 h) get HTTP
   423 with a clear message. Success stores the token the same way.
4. Auth state is client-side: `ShopContext` + `useAuth` check token presence;
   route protection is redirect-based (no router guards), and there is **no
   expiry check or 401 auto-logout**.

### 1.4 Password recovery — ✅ Implemented (K-4 fixed 2026-10-24)

1. `PasswordRecovery.tsx` → `POST /api/user/forgot-password` — returns the
   same neutral HTTP 202 response for unknown, inactive, and active accounts;
   the UI says a reset link will be attempted, not that it was delivered.
2. Backend creates a 32-byte random token, stores only its SHA-256 hash with
   a 1-hour expiry, then calls the email service.
3. The controller calls `sendPasswordResetEmail(email, user.name, resetToken)`
   and clears the pending token if the SMTP handoff fails. The service waits
   for verified SMTP and loaded templates, and builds the reset URL with the
   `FRONTEND_URL` origin. SMTP acceptance does not prove inbox delivery.
   The DB side hashes and expires the token; password consumption increments
   `tokenVersion` to invalidate existing sessions.

### 1.5 Cart — ✅ Implemented

1. Guest adds item with a chosen color → `cartItems` in localStorage:
   `{productId: {color: qty}}` (no size dimension).
2. On login, `POST /api/cart/sync-local` merges the local cart into
   `users.cartData`; server cart is then the source of truth.
3. Mutations: `POST /api/cart/add` (increments color qty), `/api/cart/update`
   (set qty; qty ≤ 0 removes), `/api/cart/get` (hydrate on boot).
4. All cart calls send the token header; the server derives `userId` from the
   token (body `userId` ignored) — cross-user cart access is impossible.
5. Add/remove events update `UserActivity` + `ProductPerformance` counters.

### 1.6 Address book — ✅ Implemented (K-11 fixed 2026-10-24)

1. Profile/checkout surfaces use `AddressBook.tsx`.
2. `POST /api/user/addresses` (first address or `default:true` becomes
   default), `GET /api/user/addresses`, `PUT /api/user/addresses/default`,
   `PUT/DELETE /api/user/addresses/:addressId` — all operate on embedded
   subdocuments of the user document.
3. **K-11 fixed 2026-10-24:** every frontend mutation caller now uses the
   routed plural endpoints — add `POST /api/user/addresses` (also the
   `PlaceOrder.tsx` delivery-form save), edit
   `PUT /api/user/addresses/:addressId` (fields only; id in the route
   param), delete `DELETE /api/user/addresses/:addressId`, set-default
   `PUT /api/user/addresses/default` with `{ addressId }`. Previously all
   mutations posted to the unrouted singular `/api/user/address…` and
   404'd. Locked by `AddressBook.test.tsx` (5 specs) + `PlaceOrder.test.tsx`.

### 1.7 Checkout — PayPal path — ✅ Implemented (❓ live PayPal UNVERIFIED)

1. `PlaceOrder.tsx` collects/validates the delivery address, then
   `POST /api/orders/paypal/create` with items + address.
2. Backend computes subtotal, +$10 shipping, USD total; creates a PayPal
   order; persists the app order with `paymentStatus:'pending'` +
   `paypalOrderId`; returns the PayPal order id. The server cart is **not**
   cleared yet.
3. Frontend renders `PayPalPayment.tsx` (PayPal JS SDK buttons, USD).
   - Client-ID comes from `VITE_PAYPAL_CLIENT_ID` with a **hardcoded sandbox
     fallback literal** (defect K-2).
4. On approval, `POST /api/orders/paypal/capture`:
   - Backend captures via PayPal API, verifies captured **amount (cents),
     currency, and capture identity** against the order; mismatch → HTTP 409,
     order untouched, ops alert logged.
   - Success → `paymentStatus:'completed'`, capture/transaction ids stored,
     server cart cleared, user `orders` array updated, Socket.IO events
     emitted (`new_order` to admin room, `order_updated` to the user), and
     any earlier `unresolved` webhook records for this capture are swept to
     `completed` (race closure).
5. Async confirmation path (independent of the browser):
   `POST /api/orders/paypal/webhook` — signature-verified (fail-closed),
   idempotent, with bounded retry + reconciliation for unmatched captures.
   See [09-OPERATIONS.md](./09-OPERATIONS.md) §5.

### 1.8 Checkout — COD and Card paths — ✅ order creation (K-1 fixed 2026-10-24)

1. The UI offers COD and Card ("stripe"-keyed) methods alongside PayPal.
2. Both paths now submit a **real order** through `POST /api/orders` with the
   same item contract as the PayPal path. The UI maps `cod` → `paymentMethod:'COD'`
   and `stripe` → `paymentMethod:'Card'` (schema enum `COD/PayPal/Card`).
3. Orders are saved with `paymentStatus:'pending'` and `orderStatus:'Order
   Placed'`; the server clears `cartData`, pushes the order onto the user,
   emits socket events, and the storefront mirrors by clearing the local
   cart and redirecting to `/orders`.
4. Card remains **gateway-less**: the order records the intent, and the store
   arranges/collects the card payment manually before or on delivery (same
   operational state as COD until a gateway is integrated).
5. Guards: the backend rejects non-whitelisted payment methods (legacy
   `'stripe'`, lowercase `'cod'`) with an explicit 400; the storefront blocks
   empty carts and unauthenticated submissions.

### 1.9 Order tracking — ✅ Implemented

1. `Orders.tsx` → `POST /api/orders/userorders` lists the shopper's orders
   with status and payment status.
2. Realtime: the storefront's `useWebSocket` connects with the auth token;
   server authenticates the handshake and joins room `user_<id>`.
3. Admin order changes emit minimal `order_updated` state notifications
   (including `type:'payment_update'` for payment changes); new orders emit a
   minimal `new_order` notice. The admin list and customer Orders page patch
   visible statuses and fetch full order data through their authorized APIs
   when pagination/filter membership may have changed.
4. `user_typing` / `user_stop_typing` are relayed by the server inside
   `order_<id>` rooms; the current frontend handlers only console-log them.

### 1.10 PWA behaviors — ✅ Implemented

1. Service worker registers via `registerSW` (autoUpdate strategy).
2. Runtime caching: fonts, PayPal assets, Cloudinary images.
3. Offline: `OfflinePage` overlay when navigation fails offline.
4. Install: the navigation bar exposes an `Install App` action only when the
   app is not installed. The guide opens on user request; supported browsers
   use their captured `beforeinstallprompt` event, while iOS and browsers
   without a native prompt receive manual installation instructions. No
   installation prompt appears automatically.
5. Not built: push notifications, background sync (any claim otherwise in
   legacy docs is template text). Manifest references
   `apple-touch-icon.png` / screenshots that are absent from `public/`.

## 2. Admin flows (admin panel)

### 2.1 Login — ✅ Implemented

1. `Login.tsx` → `POST /api/user/admin` with `ADMIN_EMAIL`/`ADMIN_PASSWORD`
   (env-configured operator credentials).
2. Success → 1-day admin JWT in `localStorage['token']` (same key as the
   storefront).
3. `App.tsx` gates the whole panel with a top-level token ternary (no router
   guards, no 404 route — unknown paths render blank).
4. No expiry handling or 401 auto-logout; logout just clears the token.

### 2.2 Product add — ✅ Implemented

1. `add.tsx` builds FormData: name, description, price, category (fixed list:
   iPhone / iPad / Mac / Watch / AirPods / Accessories), subCategory,
   bestseller, color (multi-select from 10 hardcoded options), stockQuantity,
   up to 4 images (`image1`–`image4`).
2. `POST /api/product/add` (multipart, admin-guarded) → multer validates
   MIME/size → images uploaded to Cloudinary (`ecommerce/products` folder,
   800×800 limit, auto quality/format) → product document created
   (`inStock` derived from `stockQuantity > 0`).
3. No size variants; no product edit (delete + re-add is the only workflow).

### 2.3 Product list & delete — ✅ Implemented

1. `list.tsx` paginates 20/page via `POST /api/product/list`.
2. Delete → `POST /api/product/remove` (admin) — also destroys the
   Cloudinary images (failure to delete images is logged but does not block
   the product deletion).

### 2.4 Order management — ✅ Implemented

1. `orders.tsx` → `GET /api/orders/all` (admin) — filters provided by the
   server (`filters.orderStatuses`, payment statuses: pending / completed /
   failed / refunded).
2. Advance status → `PUT /api/orders/status` (admin) with a server-side
   whitelist (the 6 `ORDER_STATUSES`); 'Delivered' stamps `deliveredAt`.
3. Every accepted update fans out over Socket.IO to the shopper
   (`order_updated`) — the emit helpers are null-safe if realtime is down.
4. PayPal transaction id is displayed on order cards; money is rendered with
   `Intl.NumberFormat` USD + daisyUI tooltips.
5. Refunds are an **API-only** admin action (`POST /api/orders/refund` — no
   dashboard button yet). The intent is claimed before the gateway call, so a
   double click cannot refund twice. `refundStatus` (not `paymentStatus`) is
   the truth while the provider is undecided:

```
POST /api/orders/refund
  already completed              → 200 alreadyRefunded
  payment not completed          → 400
  refund pending/indeterminate   → 409 REFUND_PENDING_RECONCILIATION
  no capture id (PayPal)         → 409
  claim intent atomically        → refundStatus 'pending'
     PayPal COMPLETED            → 200 refunded + inventory released
     PayPal PENDING              → 202 stays 'pending' (money not returned)
     PayPal 4xx rejection        → 502 refundStatus 'failed' (safe to retry)
     timeout / 5xx / unknown     → 502 indeterminate, stays 'pending' + alert
     COD/Card (manual)           → 200 recorded, inventory released
```

Inventory release is durable: a failed product credit leaves
`inventoryRestoration.status = 'reconciliation_required'` and is retried by
the sweep, never silently dropped.

### 2.5 Analytics views — ✅ Implemented

1. Pages: `/` dashboard summary, `/analytics/sales`, `/analytics/products`,
   `/analytics/users`, `/analytics/search`.
2. All read admin-guarded endpoints under `/api/analytics/*`. Sales
   analytics aggregate **live from the orders collection** (last 30 days by
   default, or explicit `startDate`/`endDate`), not from pre-aggregated
   documents. The category breakdown joins `items.productId` (string) to
   `products._id` via a `$convert`-normalized ObjectId key (K-12 fixed
   2026-10-24 — previously the type mismatch made it always empty).
3. Presentation is stat cards and lists only — there is no chart library in
   the admin bundle.
4. Header inconsistency (cosmetic): axios pages send `{ headers: { token } }`
   while analytics pages use `fetch` + `Authorization: Bearer`. Both are
   accepted by the API.

## 3. System flows (backend)

### 3.1 Startup — ✅ Implemented

```
process safety nets (uncaughtException → exit 1, unhandledRejection → log)
  → shutdown manager wiring (SIGTERM/SIGINT)
  → validateRuntimeConfig guardrails            (config/startupValidation.js)
       FATAL: PAYPAL_ENV=live + placeholder/missing PayPal creds → exit 1
       FATAL: NODE_ENV=production + missing JWT_SECRET           → exit 1
       WARN : sandbox in prod · live in non-prod · missing admin creds …
  → connectDB (fail-fast, redacted log)         (config/mongodb.js)
  → connectCloudinary                           (config/cloudinary.js)
  → socketService.initialize(server)            (same HTTP server)
  → listen 0.0.0.0:$PORT
```

### 3.2 Request pipeline — ✅ Implemented

Drain gate (503 while shutting down; health exempt) → helmet CSP → global
rate limit (1000 req / 15 min / IP) → compression → CORS allowlist →
`express.json` (10 mb; raw bytes captured for the webhook route) →
urlencoded → mongo-sanitize → routers (user router additionally behind an
auth limiter, 20 / 15 min) → health endpoints + `/api/socket/status` + `/`
→ multer error handler → global error handler (redacted) → 404 JSON.

### 3.3 Webhook processing state machine — ✅ Implemented

```
delivery → signature verify (fail-closed; any failure → 400/500, NO order write)
        → structural validation of the capture resource (before any DB write)
        → atomic acquisition on webhookevents.eventId (unique index)
             existing completed  → 200 duplicate (ack)
             fresh processing     → 500 (PayPal retries later)
             failed/unresolved/
             stale processing/
             legacy no-status    → re-acquire and re-process
        → PAYMENT.CAPTURE.COMPLETED:
             match order by capture id → else paypalOrderId → else
             related_ids.order_id (delayed-creation reconciliation)
             verify identity + amount(cents) + currency → mismatch:
                  unresolved + retryable 500 (bounded by
                  WEBHOOK_MAX_UNMATCHED_ATTEMPTS, default 10)
             refunded order  → never modified
             success → paymentStatus 'completed', record ids, event completed
             retry budget exhausted → terminal 200 +
                  result 'no_matching_order_retry_exhausted' + ops alert
        → PAYMENT.CAPTURE.REFUNDED:
             match order by refundId → else capture id from the
             resource 'up' link → else terminal alert
             verify refund amount(cents) + currency vs order
             COMPLETED → paymentStatus 'refunded', refundStatus
                  'completed', inventory released once
             PENDING   → stays pending
             FAILED/CANCELLED/DENIED → refundStatus 'failed', order
                  stays paid (retryable)
             unknown status → terminal 200 + ops alert
```

### 3.4 Graceful shutdown — ✅ Implemented

SIGTERM/SIGINT → drain flag (non-health routes 503; `/health/ready` 503 for
the whole window) → HTTP close (force-destroys keep-alives on timeout) →
Socket.IO close → MongoDB close — all bounded by one budget
(`SHUTDOWN_TIMEOUT_MS`, default 10 s); clean shutdown exits 0, forced/unclean
exits 1 with a one-time notification. Duplicate signals are no-ops.
