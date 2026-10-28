# NovaCart — Database Schema (MongoDB, As-Built)

> **Status:** Derived directly from `backend/models/*.js` on 2026-10-24.
> Terminology: **collections**, **documents**, **fields**, **references**,
> **indexes** (this is a Mongoose/MongoDB codebase — there are no tables and
> no migration framework; indexes are declared on the schemas and created by
> Mongoose when each model is first registered).
>
> **Chain:** [01-PRD.md](./01-PRD.md) → [02-APP_FLOWS.md](./02-APP_FLOWS.md) →
> [03-TECH_ARCHITECTURE.md](./03-TECH_ARCHITECTURE.md) → **this file** →
> [05-API_REFERENCE.md](./05-API_REFERENCE.md)

## 1. Overview

8 model files register **12 models** → 12 collections. Two fields conventions
apply across all schemas: `timestamps: true` adds `createdAt`/`updatedAt`;
Mongoose adds `_id` (ObjectId) and `__v` unless suppressed. Model names with
an explicit `collection` option are noted.

| Model (file) | Collection | Primary role | Status |
|---|---|---|---|
| `user` (userModel.js) | `users` | Accounts + **embedded cart & address book** | Live |
| `product` (productModel.js) | `products` | Catalog | Live |
| `order` (orderModel.js) | `orders` | Orders incl. PayPal lifecycle | Live |
| `Category` (categoryModel.js) | `categories` | Category tree | Live |
| `Address` (addressModel.js) | `addresses` | Orphaned standalone addresses | 🪦 no runtime caller |
| `webhookEvent` (webhookEventModel.js) | `webhookevents` (explicit) | PayPal webhook idempotency + state machine | Live |
| `UserActivity` (analyticsModel.js) | `useractivities` | Behavioral event stream | Live |
| `SalesAnalytics` (analyticsModel.js) | `salesanalytics` | Pre-aggregated daily sales | 🪦 no runtime writer |
| `ProductPerformance` (analyticsModel.js) | `productperformances` | Per-product funnel metrics | Live |
| `SearchAnalytics` (analyticsModel.js) | `searchanalytics` | Query popularity | Live |
| `revokedSession` (revokedSessionModel.js) | `revokedsessions` | Revoked JWT session ids, retained through token expiry | Live |

## 2. `users`

| Field | Type | Rules / notes |
|---|---|---|
| `name` | String | Required; 2–50 chars; **letters and spaces only** (custom validator) |
| `email` | String | Required; unique; lowercased; `validator.isEmail` |
| `password` | String | Required; ≥ 8 chars; `select:false`; strength enforced in pre-save (upper+lower+digit+special) and in controllers |
| `cartData` | Object (default `{}`) | **Server cart**: `{ productId: { color: quantity } }`; `minimize:false` preserves empty nested objects |
| `orders` | Array\<ObjectId ref `order`\> | Denormalized list of the user's order ids (also derivable from `orders.userId`) |
| `addresses` | Array of embedded subdocuments | The **real address book** — see below |
| `role` | String enum `user` \| `admin` (default `user`) | DB users may be admins (analytics middleware accepts this); the operator login is env-based and does not create a document here |
| `isActive` | Boolean (default `true`) | Soft-disable; checked on login and profile reads |
| `lastLogin` | Date | Stamped on login/registration |
| `passwordResetToken` / `passwordResetExpires` | String / Date | `select:false`; **only the SHA-256 hash of the emailed token is stored**; 1 h expiry |
| `loginAttempts` / `lockUntil` | Number / Date | `select:false`; 5 failures → 2 h lock |
| `twoFactorSecret`, `twoFactorEnabled`, `biometricEnabled`, `biometricCredentials` | — | 🪦 Declared but no code path uses them (2FA/biometric are not implemented) |
| `createdAt` / `updatedAt` | Date | timestamps |

Embedded `addresses[]` subdocument: `firstName`, `lastName`, `email`,
`street`, `city`, `state`, `zipcode`, `country`, `phone` (all required,
trimmed), `deliveryInstructions` (optional), `default` (Boolean), `addedAt`
(Date). Subdocuments have their own `_id` (used by the CRUD routes).

Indexes: `{email:1}` (unique from field), `{createdAt:1}`, `{isActive:1}`,
`{passwordResetToken:1}`.

Instance methods: `updateLastLogin`, `createPasswordResetToken`,
`isPasswordResetTokenValid`, `clearPasswordResetToken`,
`incrementLoginAttempts`, `resetLoginAttempts`; virtual `isLocked`; static
`findActiveUsers`; `toJSON` strips password, reset fields, lock fields,
secrets, `__v`.

## 3. `products`

| Field | Type | Rules / notes |
|---|---|---|
| `name` | String | Required; 2–100; indexed |
| `description` | String | Required; 10–1000 |
| `price` | Number | Required; > 0 |
| `image` | Array\<String\> | Required; 1–4 Cloudinary URLs |
| `category` | String | Required; indexed; free-form string (admin UI offers iPhone/iPad/Mac/Watch/AirPods/Accessories) |
| `subCategory` | String | Required; indexed |
| `color` | Array\<String\> | Required; every value must be one of 10 allowed: Black, Black Titanium, Desert Titanium, Gold, Pink, Silver, Teal, Ultramarine, White, Yellow |
| `bestseller` | Boolean | default `false`; indexed |
| `date` | Number | default `Date.now()` — used for "latest" sorting |
| `inStock` | Boolean | default `true`; auto-set `false` on save when `stockQuantity ≤ 0` |
| `stockQuantity` | Number | default `0`; ≥ 0; **live inventory** — atomically decremented on reservation (`stockQuantity >= qty` + `$inc`) and credited back on cancel/refund/expiry (K-5, K-13) |
| `restorationCredits` | `[String]` | `select: false` — exactly-once restoration ledger. Each entry is `<orderId>:<itemIndex>`, added by the SAME atomic `findOneAndUpdate` that increments `stockQuantity`; the `$ne` filter makes retries/concurrent sweeps no-ops. Never exposed by the product API. See `docs/09` §5.2 |
| `reservationDebits` | `[String]` | `select: false` — creation-time debit ledger (K-21). Each entry is `<orderId>:<itemIndex>`, added by the SAME atomic `findOneAndUpdate` that decrements `stockQuantity` for an order draft. It proves which lines an uncommitted draft actually took, so the abandonment sweep credits exactly those and never invents stock. Removed by the credit that returns the line; never exposed by the product API |
| `ratings.average` / `ratings.count` | Number / Number | 0–5 / ≥ 0; **no submission flow exists** — display-only |
| `featured` | Boolean | 🪦 declared, no consumer |
| `createdAt` / `updatedAt` | Date | timestamps |

Indexes: `name` (asc), `category`, `subCategory`, `bestseller`,
`inStock`, `featured` (field-level); compound `{category:1, subCategory:1}`,
`{price:1}`, `{bestseller:1, featured:1}`, `{inStock:1, stockQuantity:1}`;
text index `{name:'text', description:'text'}` (search uses regex `$or`,
not this index).

## 4. `orders`

| Field | Type | Rules / notes |
|---|---|---|
| `userId` | ObjectId ref `user` | Required |
| `items[]` | Embedded subdocuments (`_id:false`) | `productId` (String — the product id at purchase time), `name`, `image`, `price`, `quantity` (≥1), `color`, `stockRestored` (Boolean, default `false` — durable per-item marker set **only after** that item's units are back in the catalog; see `services/reservationService.js`) — **a snapshot**, immune to later catalog edits |
| `address` | Embedded subdocument (`_id:false`) | Same address fields as the user address book (no `default`/`addedAt` here) — a snapshot of delivery data |
| `paymentMethod` | String enum `COD` \| `PayPal` \| `Card` | Required; `'Card'` (added 2026-10-24, K-1 fix) = gateway-less recorded card intent — order stays `paymentStatus:'pending'` until the store completes it out-of-band |
| `paymentStatus` | String enum `pending` \| `completed` \| `failed` \| `refunded` | default `pending`; `completed` set by verified capture/webhook; `refunded` set only when a refund is **completed** (gateway `COMPLETED` or a recorded manual refund) |
| `stockReserved` | Boolean | default `false`; `true` **only after** every line of the reservation has been debited (`stockReservation.status:'reserved'`). Cleared atomically as the **release claim** shared by cancel, refund and the expiry sweep — exactly one path can claim it |
| `stockReservation` | Subdocument | Creation-time reservation state (K-21): `status` (`none` \| `pending` \| `reserved` \| `releasing` \| `failed`), `startedAt`, `completedAt`, `attempts`, `lastError`. The order is inserted as a `pending` draft **before** any decrement; an uncommitted draft older than 2 minutes is settled by the sweep (`releaseAbandonedReservations`), which credits its marked lines and then deletes the draft — so no terminal “released” document ever exists |
| `reservationExpiresAt` | Date / null | PayPal holds expire 30 min after creation (`PAYPAL_RESERVATION_TTL_MS`); `null` for COD/Card (no gateway hold) |
| `inventoryRestoration` | Subdocument | Durable release/restoration state: `status` (`none` \| `pending` \| `completed` \| `reconciliation_required`), `attempts`, `lastError`, `startedAt`, `completedAt`. A failed product credit stays `reconciliation_required` and is retried by every sweep — the obligation is never dropped |
| `orderStatus` | String enum `ORDER_STATUSES` | default `'Order Placed'`; the exported constant `ORDER_STATUSES` in `orderModel.js` is the single source of truth (6 values) |
| `subtotal`, `shipping`, `total` | Number | Required; `shipping` default **10** (fixed fee, set by controller); `total = subtotal + shipping` |
| `currency` | String | default `'USD'`; the only currency in the system |
| `paypalOrderId` / `paypalCaptureId` / `paypalTransactionId` | String | `sparse: true` — absent for COD orders |
| `refundStatus` | String enum `pending` \| `completed` \| `failed` / null | default `null`. `pending` = requested but **not confirmed** (PayPal PENDING or indeterminate transport failure); blocks a second automatic refund. `completed` = money returned. `failed` = definitive provider rejection, safe to retry |
| `refundedAt` / `refundId` / `refundMethod` / `refundReason` / `refundAttempts` / `refundLastError` | Date / String / `paypal` \| `manual` / String / Number / String | Refund bookkeeping; `refundedAt` is stamped only on completion |
| `trackingNumber`, `estimatedDelivery`, `deliveredAt` | String / Date / Date | `sparse`; only `deliveredAt` is written (stamped when status → Delivered) — tracking fields have no writer |
| `notes` | String | optional |
| `isActive` | Boolean | default `true`; soft-delete flag honored by queries |
| `createdAt` / `updatedAt` | Date | timestamps |

Indexes: `{userId:1, createdAt:-1}`, `{paymentStatus:1}`, `{orderStatus:1}`,
`{createdAt:-1}`, `{userId:1, idempotencyKey:1}` (unique, partial on string keys),
`{paymentStatus:1, stockReserved:1, reservationExpiresAt:1}` (expiry sweep),
`{'inventoryRestoration.status':1}` (restoration retry sweep),
`{'stockReservation.status':1, 'stockReservation.startedAt':1}` (abandoned-draft
sweep). (Sparse PayPal fields are indexed by their field declarations.)

Statics: `findByUser` (paginated), `findAllOrders` (paginated + user
population), `findByPayPalOrderId`, `findByPayPalCaptureId`. Instance:
`updateStatus` (stamps `deliveredAt` on Delivered), `updatePaymentStatus`.

**Order status values:** `Order Placed` → `Packing` → `Shipped` →
`Out for delivery` → `Delivered`, plus `Cancelled` (any point, admin).

## 5. `categories`

| Field | Type | Notes |
|---|---|---|
| `name` | String | Required; **unique** |
| `description` | String | default `''` |
| `isActive` | Boolean | default `true` |
| `sortOrder` | Number | default `0` |
| `subCategories[]` | Embedded subdocuments | `name` (required), `description`, `isActive`, `sortOrder`; own timestamps; subdocument `_id` present |
| `createdAt` / `updatedAt` | Date | timestamps |

Indexes: `{isActive:1, sortOrder:1}`, `{name:1}`. The admin panel has no
category UI; mutations go through the API (the unrouted storefront page
`AdminCategories.tsx` is the only UI consumer).

## 6. `addresses` — 🪦 orphaned collection

Standalone schema identical to the address snapshot fields. Written only by
`POST /api/address/save`, which has **no frontend caller** (the real address
book is embedded in `users.addresses`). Retained for compatibility; treat as
deprecated surface. Timestamps present.

## 7. `webhookevents` (explicit collection name)

| Field | Type | Notes |
|---|---|---|
| `eventId` | String | Required; **unique index** — the idempotency key and atomic acquisition gate |
| `eventType` | String | Required (e.g. `PAYMENT.CAPTURE.COMPLETED`) |
| `resourceId` | String | Capture/resource id |
| `status` | String enum `processing` \| `completed` \| `failed` \| `unresolved` | State machine — see below |
| `attempts` | Number | ≥ 1; incremented per acquisition |
| `lastError` | String | **Redacted, length-bounded** error of the last failed attempt |
| `completedAt` | Date | Set on completion |
| `result` | String | `order_updated` \| `order_updated_reconciled` \| `no_matching_order` \| `no_matching_order_retry_exhausted` \| `amount_currency_mismatch` \| `capture_order_mismatch` \| `ignored_event_type` |
| `processedAt` | Date | default `Date.now` |
| `createdAt` / `updatedAt` | Date | timestamps |

**State machine:** `processing` → `completed` (duplicate deliveries from
here on are acknowledged with 200) | `failed` (retry re-acquires) |
`unresolved` (verified capture that could not be safely applied — no
matching order, or identity/amount/currency verification failed; retried
within `WEBHOOK_MAX_UNMATCHED_ATTEMPTS` (default 10), then terminal-acked
with an ops alert). Stale `processing` (beyond
`WEBHOOK_PROCESSING_LOCK_MS`, default 30 s) and legacy no-status records are
re-acquired — safe because the order update is idempotent. A fresh
`processing` lock answers 500 so PayPal retries later.

## 8. Analytics collections (`analyticsModel.js`)

### 8.1 `useractivities` — live event stream

`userId` (ref `user`, required), `action` (enum: `login`, `logout`,
`view_product`, `add_to_cart`, `remove_from_cart`, `purchase`, `search`,
`filter`), `productId` (ref `product`, sparse), `category` (sparse),
`searchQuery` (sparse), `sessionId` (sparse), `userAgent` (sparse),
`ipAddress` (sparse), timestamps. Indexes: `{userId:1, createdAt:-1}`,
`{action:1, createdAt:-1}`, `{productId:1, createdAt:-1}`.

Writers: productController (view_product, search), cartController
(add_to_cart, remove_from_cart), orderController (purchase — one event per
order, not per item), analyticsController (`track-activity`), dev scripts.
Note: `login`/`logout`/`filter` enum values exist but no controller emits
them.

### 8.2 `salesanalytics` — 🪦 no runtime writer

`date`, `totalSales`, `totalOrders`, `averageOrderValue`, `totalProducts`,
`categorySales` (Map of `{sales, orders, products}`),
`paymentMethodBreakdown` (Map→Number), `orderStatusBreakdown` (Map→Number),
timestamps; index `{date:-1}`. The admin sales endpoint aggregates **live
from `orders`** instead; this collection is populated only if someone runs
`scripts/populateAnalytics.js`-style tooling manually.

### 8.3 `productperformances` — live funnel metrics

`productId` (ref, required), `views`, `addToCartCount`, `purchaseCount`,
`revenue`, `conversionRate` (declared; **nothing computes it**), `lastUpdated`,
timestamps. Indexes: `{productId:1}`, `{views:-1}`, `{revenue:-1}`. Updated
via `updateProductMetrics` upsert (`$inc`) from product/cart/order
controllers.

### 8.4 `searchanalytics` — live query popularity

`query` (required, lowercased on upsert), `count`, `resultsCount`,
`category` (sparse), `date`, timestamps. Indexes: `{query:1}`, `{count:-1}`,
`{date:-1}`. One document per distinct query with a hit counter
(`trackSearch` upsert).

## 9. Reference map

| From | To | Kind |
|---|---|---|
| `users.orders[]` | `orders._id` | ObjectId ref (denormalized mirror of `orders.userId`) |
| `orders.userId` | `users._id` | ObjectId ref |
| `useractivities.userId` / `.productId` | `users` / `products` | ObjectId refs |
| `productperformances.productId` | `products` | ObjectId ref |
| `orders.items[].productId` | — | **String snapshot, not a ref** (items are immutable purchase snapshots) |

## 10. Data lifecycle notes (honest gaps)

- **TTL cleanup** — `revokedsessions` has an `expiresAt` TTL index so revoked
  JWT ids are removed after the token can no longer be used.
- **No TTL indexes** — `useractivities`, `webhookevents`, and
  `searchanalytics` grow unboundedly; retention/cleanup is a manual ops task
  (an admin `POST /api/analytics/cleanup` endpoint exists for orphaned
  analytics records).
- **No migration framework** — schema evolution is code-first (Mongoose
  validates on write; old documents simply lack newer fields). The
  `scripts/migrateOrders.js` utility is a one-off, not a framework.
- **No backup tooling in the repository** — backups are a deployment/owner
  responsibility ([06-DEPLOYMENT.md](./06-DEPLOYMENT.md)).
- **`webhookevents` retention** — completed records are kept (they are the
  duplicate-suppression ledger); prune old `completed` rows only after
  PayPal's redelivery window is comfortably past.
