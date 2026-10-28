# NovaCart — API Reference (As-Built)

> **Status:** Enumerated from the route files and controllers on 2026-10-24.
> Base URL: `http(s)://<backend-host>:<PORT>` (default `3001` in dev).
> **47 router endpoints across 7 routers + 5 app-level routes.**
>
> **Chain:** [01-PRD.md](./01-PRD.md) → [02-APP_FLOWS.md](./02-APP_FLOWS.md)
> → [03-TECH_ARCHITECTURE.md](./03-TECH_ARCHITECTURE.md) →
> [04-DATABASE_SCHEMA.md](./04-DATABASE_SCHEMA.md) → **this file** →
> [07-TESTING_PLAN.md](./07-TESTING_PLAN.md)

## 1. Conventions

- **Envelope:** success responses are JSON `{ success: true, ... }`; errors
  are `{ success: false, message }` (validation adds `errors[]`; analytics
  endpoints predate the envelope and return plain `{ message }` shapes).
- **Auth:** token in a custom **`token` header** (storefront convention) or
  **`Authorization: Bearer`** (admin analytics pages) — both accepted.
  Shopper tokens: 7-day HS256 JWT with user id, token version, token type and
  unique session id. Admin tokens: 1-day HS256 JWT with `{email,
  role:'admin', type:'admin'}` and a unique session id, or a DB user with
  `role:'admin'`.
- **Rate limits:** global 1000 req / 15 min / IP; the whole `/api/user` router
  additionally sits behind an auth limiter (20 req / 15 min / IP).
- **CORS:** development localhost origins are enabled only outside production.
  Production browser origins come from `FRONTEND_URL`, `ADMIN_URL` and
  `CORS_EXTRA_ORIGINS`; unlisted origins are rejected.
- **Body limits:** 10 MB (JSON + urlencoded). Webhook route only: exact raw
  bytes preserved for signature verification.
- **Errors:** 401 unauthenticated · 403 authenticated-but-forbidden ·
  400 validation · 404 missing · 409 capture verification conflict ·
  423 locked account · 429 rate-limited · 500 server (production message is
  generic `Internal Server Error`; non-production messages are redacted) ·
  503 while draining or shutting down. Unknown routes → 404 JSON.
- **Status labels** follow the PRD legend.

## 2. App-level routes

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /` | none | Liveness banner `{ success:true, message:'API Working 🚀' }` |
| `GET /health` | none | Legacy health: `{ success:true, message:'Server is healthy ✅' }` |
| `GET /health/live` | none | Process liveness: `{ status:'live', uptime }` — always 200 while the process is up |
| `GET /health/ready` | none | Readiness: 200 `{status:'ready', checks:{database:true}}` when MongoDB is connected; 503 when disconnected **or for the entire drain window** (`checks.shuttingDown:true`) |
| `GET /api/socket/status` | none | `{ success:true, connectedUsers, status }` |

## 3. `/api/user` — userRouter (behind auth limiter)

| # | Method & path | Auth | Handler | Notes |
|---|---|---|---|---|
| 1 | `POST /register` | public | `registerUser` | Body `{name, email, password}`. Validates email + password strength; bcrypt(12). 201 → `{success, token, user:{id,name,email,role}}`. Welcome email async. 400 if email taken / invalid |
| 2 | `POST /login` | public | `loginUser` | Body `{email, password}`. 200 + token; 401 invalid; **423 if locked** (5 fails → 2 h); stamps `lastLogin`, resets attempts |
| 3 | `POST /admin` | public | `adminLogin` | Body `{email, password}` compared to `ADMIN_EMAIL`/`ADMIN_PASSWORD` env (plaintext compare — known limitation S3). 200 → 1-day admin token `{user:{email, role:'admin'}}`; 401 otherwise; 500 if admin env unset |
| 4 | `POST /logout` | `authUser` | `logoutUser` | Revokes this JWT session across tabs/devices; older shopper tokens without a session id fall back to account tokenVersion revocation |
| 5 | `POST /admin/logout` | `authAdmin` | `logoutAdmin` | Revokes this admin JWT session across tabs/devices |
| 6 | `POST /forgot-password` | public | `requestPasswordReset` | Body `{email}`. Always the same neutral 202 response for unknown, inactive, and active accounts. Stores a 1-hour hashed token; clears it when SMTP handoff fails. Response/UI do not claim inbox delivery. SMTP transport is verified before send; link uses the configured frontend origin. |
| 7 | `POST /reset-password` | public | `resetPassword` | Body `{token, newPassword}`. Hashes token, matches with expiry; validates strength; bumps tokenVersion and closes all active sockets for the account; 200 on success; 400 invalid/expired |
| 8 | `GET /profile` | `authUser` | `getUserProfile` | 200 `{user:{id,name,email,role,createdAt,lastLogin}}`; 404 |
| 9 | `PUT /profile` | `authUser` | `updateUserProfile` | Body `{name?, email?}`; email uniqueness checked; 200 updated user |
| 10 | `POST /addresses` | `authUser` | `addUserAddress` | Body = address subdocument (see §3.1). `default:true` demotes the rest; as-built a first address is NOT auto-defaulted unless flagged. 200 `{addresses}` |
| 11 | `GET /addresses` | `authUser` | `getUserAddresses` | 200 `{addresses}` |
| 12 | `PUT /addresses/default` | `authUser` | `setDefaultAddress` | Body `{addressId}`; 404 if not owned |
| 13 | `PUT /addresses/:addressId` | `authUser` | `editUserAddress` | Body = fields to merge |
| 14 | `DELETE /addresses/:addressId` | `authUser` | `deleteUserAddress` | |
| 15 | `GET /debug` | `authAdmin` | `debugUsers` | Admin-only user dump (sensitive fields excluded). Was user-accessible before Phase 1 |

Address subdocument fields (all required except `deliveryInstructions`,
`default`): `firstName, lastName, email, street, city, state, zipcode,
country, phone, [deliveryInstructions], [default]`.

## 4. `/api/product` — productRouter

| # | Method & path | Auth | Handler | Notes |
|---|---|---|---|---|
| 1 | `GET /list` | public | `listProducts` | Query: `page` (1), `limit` (10), `category`, `subCategory`, `inStock`, `bestseller`, `search` (regex over name+description, case-insensitive). 200 `{products, pagination:{currentPage,totalPages,totalProducts,hasNextPage,hasPrevPage}}`. Records search analytics when `search` + token present |
| 2 | `POST /single` | public | `singleProduct` | Body `{productId}`. 200 `{product}`; 404. Records `view_product` + view metric when token present |
| 3 | `POST /add` | `authAdmin` | `addProduct` | **multipart/form-data**: `name, description, price, category, subCategory, color` (JSON array string ok), `bestseller` ('true'), `stockQuantity`, files `image1..image4` (multer MIME/size limits). Images → Cloudinary. 201 `{product}` |
| 4 | `POST /remove` | `authAdmin` | `removeProduct` | Body `{id}`. Destroys Cloudinary images (best-effort) then the document. 404/200 |

🪦 `updateProductStock` exists in the controller but is **not routed**.

## 5. `/api/cart` — cartRouter (all `authUser`)

Ownership is always derived from the token (`req.user.id`); body `userId` is
ignored. **Admin tokens get 403** (`Shopper authentication required`).

| # | Method & path | Handler | Body → result |
|---|---|---|---|
| 1 | `POST /add` | `addToCart` | `{itemId, color}` → increments `cartData[itemId][color]`; 200 `{cartData}` |
| 2 | `POST /get` | `getUserCart` | — → 200 `{cartData}` |
| 3 | `POST /update` | `updateCart` | `{itemId, color, quantity}`; `quantity ≤ 0` removes that color (and the item when no colors remain) |
| 4 | `POST /sync-local` | `syncLocalCart` | `{cartData}` — **overwrites** the server cart with the client payload (called on login) |

All four record analytics (`add_to_cart` / `remove_from_cart`).

## 6. `/api/orders` — orderRouter

| # | Method & path | Auth | Handler | Notes |
|---|---|---|---|---|
| 1 | `POST /` | `authUser` | `placeOrder` | **COD/Card order creation.** Body `{items[], address, paymentMethod}` — `paymentMethod` must be one of `COD \| Card` (400 with an explicit message otherwise; `PayPal` is rejected here on purpose so PayPal orders carry a `paypalOrderId` the webhook can match). Server computes subtotal + $10 shipping, `currency:'USD'`, saves `paymentStatus:'pending'`, clears `cartData`, pushes `orders`, emits socket events, records purchase analytics. Storefront callers since the 2026-10-24 K-1 fix: `PlaceOrder.tsx` COD (`'COD'`) and Card (`'Card'`) paths. Card = gateway-less recorded intent (store collects manually) |
| 2 | `POST /paypal/create` | `authUser` | `placeOrderPayPal` | Body items+address. Creates the PayPal order + a pending local order (`paypalOrderId` stored, stock reserved, `reservationExpiresAt` = now + `PAYPAL_RESERVATION_TTL_MS`, default 30 min). Returns PayPal order id for the JS SDK. Abandoned holds are released by the sweep (`RESERVATION_SWEEP_INTERVAL_MS`, default 5 min) |
| 3 | `POST /paypal/capture` | `authUser` | `capturePayPalPayment` | Body `{orderID(PayPal)}`. Captures via PayPal, **verifies amount(cents)/currency/identity** → 200 `paymentStatus:'completed'` + ids; **409** on mismatch (order untouched, alert logged); **409 `ORDER_NOT_PAYABLE`** when the order was already cancelled/refunded (refused **before** the gateway call); **409 `CAPTURE_REQUIRES_RECONCILIATION`** when cancellation/refund landed while the capture was in flight (capture id is recorded for refund, order never marked paid — alert logged); sweeps earlier `unresolved` webhook events for the same capture |
| 4 | `POST /paypal/webhook` | **public, signature-verified** | `handlePayPalWebhook` | PayPal→server only. Fail-closed verification; idempotency state machine; see §6.1 |
| 5 | `POST /userorders` | `authUser` | `userOrders` | Body `{}` (userId from token). 200 `{orders}` |
| 6 | `PUT /status` | `authAdmin` | `updateStatus` | Body `{orderId, status}`; status must be one of the 6 `ORDER_STATUSES` (400 otherwise; DB untouched). 'Delivered' stamps `deliveredAt`. Fans out `order_updated` via Socket.IO |
| 6b | `POST /refund` | `authAdmin` | `refundOrder` | Body `{orderId, reason?}`. Full refunds only. Only a `completed` payment can be refunded (400 otherwise). The refund **intent is claimed atomically before the gateway call**, so concurrent/duplicate requests cannot issue two refunds (`409` for the loser; `409 REFUND_PENDING_RECONCILIATION` while a refund is pending/indeterminate). PayPal path: `COMPLETED` → 200, `paymentStatus:'refunded'`, `refundStatus:'completed'`; `PENDING` → **202**, `paymentStatus` stays `completed`, `refundStatus:'pending'` (money not returned yet); definitive 4xx rejection → 502 `PAYPAL_REFUND_REJECTED`, `refundStatus:'failed'` (safe to retry); timeout/5xx/unknown status → 502 `PAYPAL_REFUND_INDETERMINATE`, remains `pending` for reconciliation (`reconcilable:true`). `409` if the order has no capture id. COD/Card orders are recorded immediately as `refundMethod:'manual'`. Inventory is returned **only on completion**, exactly once per item, through the durable release (`inventoryRestoration`); both parties are notified over Socket.IO |
| 7 | `GET /user` | `authUser` | `userOrders` | Duplicate of #5 via GET |
| 8 | `GET /all` | `authAdmin` | `allOrders` | Admin listing incl. `filters.orderStatuses` for the UI |
| 9 | `GET /debug` | `authAdmin` | `debugOrders` | Admin-only recent-orders dump (PII — admin only since Phase 1) |

### 6.1 Webhook endpoint behavior (contract with PayPal)

Responses carry operational meaning for PayPal's redelivery:

| Outcome | HTTP | PayPal does |
|---|---|---|
| Event processed (incl. reconciled delayed orders) | 200 | done |
| Duplicate of a `completed` event | 200 | done |
| Invalid signature / malformed body / missing headers or webhook id | 400 | retried (config error on your side — fix config) |
| Fresh in-flight lock, processing failure, or **unresolved capture within retry budget** (`WEBHOOK_MAX_UNMATCHED_ATTEMPTS`, default 10) | 500 | **retried — this is the recovery path** |
| Unresolved capture, budget exhausted | 200 `no_matching_order_retry_exhausted` | stops — **ops alert logged; manual follow-up required** |

Non-`PAYMENT.CAPTURE.COMPLETED` verified events are acknowledged with result
`ignored_event_type`, **except** `PAYMENT.CAPTURE.REFUNDED`, which reconciles
the refund lifecycle (below). Verified captures never modify refunded orders and
never apply cross-order grafts (`capture_order_mismatch`).

### 6.2 Refund reconciliation (`PAYMENT.CAPTURE.REFUNDED`)

A refund is only real when PayPal reports `COMPLETED`. The signed refund event
finishes a refund left in the conservative `pending` state (PENDING result or an
indeterminate timeout), so it can reach a truthful terminal state without an
operator.

- Matching: recorded `refundId`, or the capture id in the refund resource's
  `up` link (`/payments/captures/<captureId>/refund`) — which also covers a
  refund whose id was lost to a crash after the gateway call.
- Guard: the refund amount **and** currency must equal the order total before
  any write. A partial/foreign-currency refund is flagged
  (`refund_amount_currency_mismatch`), never applied as a full refund.
- `COMPLETED` → `paymentStatus:'refunded'`, `refundStatus:'completed'`, inventory
  returned exactly once (`refund_completed`). `PENDING` → stays pending
  (`refund_pending`). `FAILED`/`CANCELLED`/`DENIED` → `refundStatus:'failed'`,
  order stays paid and retryable (`refund_failed`). Unknown order/status →
  terminal `unresolved` + ops alert (no retry storm).

## 7. `/api/category` — categoryRouter

| # | Method & path | Auth | Handler |
|---|---|---|---|
| 1 | `GET /list` | public | `getCategories` — active categories for the storefront |
| 2 | `POST /add` | `authAdmin` | `addCategory` |
| 3 | `PUT /update` | `authAdmin` | `updateCategory` |
| 4 | `DELETE /delete` | `authAdmin` | `deleteCategory` |
| 5 | `POST /subcategory/add` | `authAdmin` | `addSubCategory` |
| 6 | `PUT /subcategory/update` | `authAdmin` | `updateSubCategory` |
| 7 | `DELETE /subcategory/remove` | `authAdmin` | `removeSubCategory` |

## 8. `/api/address` — addressRouter

| # | Method & path | Auth | Handler | Notes |
|---|---|---|---|---|
| 1 | `POST /save` | `authUser` | `saveAddress` | Writes the standalone `addresses` collection. 🪦 **No frontend caller** — the real address book is `users.addresses` via `/api/user/addresses` |

## 9. `/api/analytics` — analyticsRouter (uses `protect`/`admin` middleware)

| # | Method & path | Auth | Handler | Notes |
|---|---|---|---|---|
| 1 | `POST /track-activity` | `protect` | `trackUserActivity` | Body `{action, productId?, category?, searchQuery?, sessionId?}`; records user-agent + IP. Plain `{message}` envelope |
| 2 | `GET /dashboard-summary` | `protect, admin` | `getDashboardSummary` | Headline stats for the admin dashboard |
| 3 | `GET /sales` | `protect, admin` | `getSalesAnalytics` | Query `startDate`/`endDate` (default last 30 days). **Live aggregation from `orders`** (completed payments only) + category breakdown |
| 4 | `GET /products` | `protect, admin` | `getProductPerformance` | Product funnel metrics |
| 5 | `GET /user-behavior` | `protect, admin` | `getUserBehavior` | Activity-based user stats |
| 6 | `GET /search` | `protect, admin` | `getSearchAnalytics` | Popular queries |
| 7 | `POST /cleanup` | `protect, admin` | `cleanupAnalytics` | Removes orphaned analytics records |

## 10. Socket.IO events

Connection: `io(backendUrl, { auth: { token } })` — the handshake shares the
HTTP HS256 verifier, checks expiry/account state/tokenVersion and revoked
session ids, and revalidates long-lived sockets periodically. Rooms:
`user_<id>` (shopper sockets), `admin_room` (admin-role sockets),
`order_<id>` (ownership-checked for shoppers; admin-only otherwise).

| Direction | Event | Payload / notes |
|---|---|---|
| server → client | `order_updated` | Minimal `{_id,eventId,type,orderStatus,paymentStatus,refundStatus,updatedAt}` state; `type` is `order_created`, `order_updated` or `payment_update`; union-room broadcast prevents duplicates |
| server → client | `new_order` | Minimal `{_id,eventId,type,orderStatus,paymentStatus,refundStatus,updatedAt}` notice to `admin_room`; full data is fetched through the authenticated orders API |
| server → client | `session_revoked` | `{reason}` followed by socket disconnect; emitted after logout, account tokenVersion change, expiry or authorization revalidation failure |
| server → client | `user_typing` / `user_stop_typing` | Relayed only within an authorized, joined `order_<id>` room; no email or address data |
| client → server | `typing` | `{orderId, …}` — relayed to the order room (typist's own socket excluded) |
| client → server | `join_order_room` / `leave_order_room` | Order id validated; joins are acknowledged and customer ownership is verified |

All server emits are null-safe when the realtime layer is down.

## 11. Historical note on response-envelope drift

Older endpoints (`/api/user/*`, `/api/product/*`, `/api/cart/*`,
`/api/orders/*`, `/api/category/*`, `/api/address/*`) consistently use the
`{success, …}` envelope. The newer analytics router uses `{message}` /
plain data shapes. Both are as-built behavior; clients must follow the
per-router shapes above.
