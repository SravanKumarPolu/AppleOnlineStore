# MongoDB Model Relationships — NovaCart

**Authority:** derived directly from `backend/models/*.js` on 2026-10-26. Collections live in the `e-commerce` database by default (`config/mongodb.js`: complete `MONGODB_URI` respected; bare host URI gets `MONGODB_DB` or the historical default `e-commerce`).

---

## 1. Model relationship diagram

```mermaid
erDiagram
    users ||--o{ orders : "user.orders[] ObjectId ref"
    orders }o--|| users : "order.userId ObjectId ref"
    users ||--|| carts_embedded : "user.cartData (EMBEDDED object, no collection)"
    users ||--o{ user_addresses : "user.addresses[] (EMBEDDED subdocuments)"
    orders ||--o{ order_items : "items[] (EMBEDDED, productId stored as STRING)"
    productperformances }o--|| products : "productId ObjectId ref"
    useractivities }o--|| users : "userId ObjectId ref"
    useractivities }o--o| products : "productId (string, $convert-normalized joins)"
    webhookevents {
        string eventId UK "unique — idempotency key"
        string eventType
        string resourceId "PayPal capture id"
        string status "processing|completed|failed|unresolved"
        number attempts
        string result
    }
    searchanalytics {
        string query
        number count
        number resultsCount
        date date
    }
    addresses_standalone {
        string _id "standalone collection — written ONLY by POST /api/address/save; not referenced"
    }

    users {
        ObjectId _id PK
        string email UK "unique, lowercased, validated"
        string password "bcrypt, select:false"
        object cartData "productId -> color -> qty"
        array orders "ObjectId[] -> orders._id"
        array addresses "embedded address subdocuments"
        string role "user|admin (default user)"
        boolean isActive
        number tokenVersion "AF-2 session invalidation"
        string passwordResetToken "hashed, select:false"
        date passwordResetExpires
        number loginAttempts "select:false"
        date lockUntil "select:false"
    }
    orders {
        ObjectId _id PK
        ObjectId userId FK
        array items "name, image, price (server-set), qty 1..999, color, productId STRING"
        object address "EMBEDDED snapshot (required fields)"
        string paymentMethod "COD|PayPal|Card"
        string paymentStatus "pending|completed|failed|refunded"
        string orderStatus "Order Placed|Packing|Shipped|Out for delivery|Delivered|Cancelled"
        number subtotal
        number shipping "fixed 10"
        number total "server-computed only"
        string currency "USD"
        boolean stockReserved "atomic release claim; cancel/refund/expiry restores"
        date reservationExpiresAt "PayPal hold TTL; swept when unpaid"
        object inventoryRestoration "status none|pending|completed|reconciliation_required + attempts/lastError"
        array items[].stockRestored "bookkeeping only (the product ledger is the proof)"
        string refundStatus "null|pending|completed|failed — refund truth, not paymentStatus"
        string idempotencyKey "nullable — unique per user when string"
        string paypalOrderId "sparse"
        string paypalCaptureId "sparse"
        string paypalTransactionId "sparse"
        boolean isActive
    }
    products {
        ObjectId _id PK
        string name "2..100 chars, indexed"
        string description "10..1000 chars"
        number price "server-side pricing source"
        array image "1..4 Cloudinary URLs"
        string category "STRING — matches categories.name, not a ref"
        string subCategory "STRING"
        array color "whitelisted values"
        boolean bestseller
        number date
        boolean inStock
        number stockQuantity "atomic reservation target; restored exactly once"
        array restorationCredits "select:false — one <orderId>:<index> per restored line (exactly-once proof)"
        object ratings
        boolean featured
    }
    categories {
        ObjectId _id PK
        string name UK "unique"
        string description
        boolean isActive
        number sortOrder
        array subCategories "EMBEDDED (name, description, isActive, sortOrder)"
    }
```

**Notable type quirks (verified, by design or documented history)**

- `orders.items[].productId` is a **String**, not an ObjectId reference (historical schema choice). Analytics aggregations normalize it with `$convert` before `$lookup` against `products._id` (K-12 fix). New joins must repeat that normalization.
- `products.category` links to `categories.name` **by value string**, not by ObjectId — there is no referential integrity between them; deleting a category does not update products.
- The standalone `addresses` collection (`addressModel`) is written only by `POST /api/address/save` and is read by nothing — the real address book is `users.addresses[]`. Order shipping data is an embedded snapshot on each order.

---

## 2. Index inventory (verified from schema definitions)

| Collection | Index | Kind | Purpose |
|---|---|---|---|
| users | `email` | unique | login identity, duplicate-registration guard |
| users | `createdAt`, `isActive`, `passwordResetToken` | regular | admin/analytics queries, reset lookup |
| orders | `userId + createdAt` | compound | user order listing (newest first) |
| orders | `paymentStatus`, `orderStatus` | regular | admin filters |
| orders | `userId + idempotencyKey` | **unique, partial** (`idempotencyKey` is a string) | checkout idempotency — race-safe duplicate suppression |
| orders | `createdAt` | regular | sorting |
| orders | `paypalOrderId`, `paypalCaptureId`, `paypalTransactionId`, `trackingNumber`, … | sparse | PayPal reconciliation lookups |
| webhookevents | `eventId` | **unique** | atomic webhook acquisition / idempotency |
| categories | `name` | unique | category identity |
| categories | `isActive + sortOrder` | compound | public listing |
| products | `name`, `category`, `subCategory`, `bestseller`, `inStock`, `featured` | regular | catalog filtering/search |

> Mongoose logs duplicate-index warnings for `users.email` and `categories.name` (declared both inline-`unique` and via `schema.index`). Harmless (MongoDB dedupes), noted in `KNOWN_LIMITATIONS.md`.

---

## 3. Data-integrity rules enforced at the schema/controller level

- **Prices and totals** are computed only from `products.price` at order-creation time; client-supplied prices are discarded (and rejected when malformed).
- **Stock reservation** uses an atomic conditional update (`stockQuantity >= qty`), so concurrent orders cannot oversell. Since 2026-10-26 (K-21) the order draft is inserted **before** any decrement and each line's decrement also writes a `<orderId>:<index>` debit marker in the same product update, so a crash leaves a recoverable draft instead of lost units; abandoned drafts are credited exactly once by the sweep (`docs/10` §18.4).
- **Restoration is exactly-once** via the product-side ledger: `$inc stockQuantity` + `$addToSet restorationCredits: '<orderId>:<index>'` in ONE `findOneAndUpdate` filtered by `restorationCredits: {$ne: creditId}`. A crash or concurrent retry can neither lose nor duplicate a credit; `items[].stockRestored` is bookkeeping only.
- **Webhook-applied updates** verify amount + currency against `order.total`/`order.currency` before writing, never clobber `refunded` orders, and are idempotent (`paymentStatus: 'completed'` set operationally).
- **Session invalidation:** `users.tokenVersion` vs the JWT `tv` claim — bumping on password reset invalidates all existing tokens for that user.
- **Soft deletes:** orders are filtered by `isActive: true` in shopper/admin listings; products and categories are hard-deleted (product removal also destroys Cloudinary assets best-effort).
