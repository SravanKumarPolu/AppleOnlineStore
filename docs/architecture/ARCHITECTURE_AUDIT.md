# Architecture Audit — Code vs. Supplied GitDiagram

**Audit date:** 2026-10-26
**Scope:** Full repository (`frontend/`, `admin/`, `backend/`, `docs/`) inspected file-by-file against the supplied GitDiagram system picture.
**Status:** Pre-DevOps stabilization phase. This report reflects the source code **as verified after** the Phase 2–4 corrections described in `docs/testing/SECURITY_REGRESSION.md`.

---

## 1. How the supplied diagram maps to reality

The supplied GitDiagram is a **business-level** picture: Shopper/Administrator → Storefront React PWA / React Admin Console → Express REST API → "Validation, JWT and RBAC" → Controllers & Services (users & addresses, products & categories, cart, orders & payments & inventory, analytics) → MongoDB, with Email / Cloudinary / PayPal as external services, webhook verification & idempotency, liveness/readiness probes, graceful shutdown, and Socket.IO order updates pushed to both frontends.

That topological shape is **correct**. Every box in it exists in the code. The discrepancies are in the **relationships, data flows, and boundaries** the diagram implies but the code does not implement (or implements differently). They are enumerated below and corrected in the accompanying diagrams (`SYSTEM_ARCHITECTURE.md`, `COMPONENT_DIAGRAM.md`, `DATABASE_RELATIONSHIPS.md`, `AUTH_FLOW.md`, `CHECKOUT_PAYMENT_FLOW.md`).

---

## 2. Accurate relationships (verified in code)

| # | Relationship (as drawn) | Verdict | Evidence |
|---|---|---|---|
| 1 | Shopper → Storefront React PWA → Express REST API | ✅ Accurate | `frontend/src` (React 18 + Vite PWA), all API calls via `fetch` to `VITE_BACKEND_URL` |
| 2 | Administrator → React Admin Console → Express REST API | ✅ Accurate | `admin/src` (React 19 + Vite), axios + fetch to `/api/user/admin`, `/api/orders/*`, `/api/product/*`, `/api/analytics/*` |
| 3 | REST API → Validation/JWT/RBAC layer → Controllers | ✅ Accurate | `middleware/validation.js` (express-validator), `middleware/auth.js` (authUser/authAdmin), route-level wiring in `routes/*.js` |
| 4 | Controllers → MongoDB via Mongoose models | ✅ Accurate | All 7 controllers use the models in `models/` |
| 5 | Product upload → backend upload middleware → Cloudinary | ✅ Accurate | `routes/productRoute.js` → `middleware/multer.js` (disk staging, image whitelist, 5 MB cap) → `productController.addProduct` → Cloudinary SDK upload (`ecommerce/products` folder) |
| 6 | PayPal webhook → signature verification → event persistence | ✅ Accurate | `services/paypalWebhookService.js` (verify-webhook-signature API, fail-closed) + `models/webhookEventModel.js` (unique `eventId`, state machine) |
| 7 | Order updates → Socket.IO → clients | ✅ Accurate (with a caveat, §3.1) | `services/socketService.js` emits `order_updated` / `new_order` / payment & shipping updates to `user_<id>` and `admin_room` |
| 8 | Liveness/Readiness health checks + graceful shutdown | ✅ Accurate | `/health/live`, `/health/ready` (DB readyState + drain flag), `utils/shutdownManager.js` (bounded http→sockets→db phases) |
| 9 | Email provider integration | ✅ Accurate | `services/emailService.js` (nodemailer SMTP + templates; welcome + password-reset; non-blocking) |
| 10 | Controllers & Services include orders/payments/inventory module | ✅ Accurate | `orderController.js` implements pricing, atomic stock reservation, capture verification, webhook reconciliation |

---

## 3. Incorrect or misleading relationships (corrected)

### 3.1 Socket.IO pushes order updates to **both** frontends
The diagram draws "Order updates" from Socket.IO to both the Storefront and the Admin Console. **Only the storefront consumes it.** `admin/` has no `socket.io-client` dependency at all (verified: zero imports). The backend *supports* admin realtime (`admin_room`, `admin_join_order` events), but nothing connects to it. The corrected diagrams mark the admin realtime leg as **backend capability, currently unused by the admin UI**.

### 3.2 The old GitDiagram's controller→model arrows
The original GitDiagram (pre-correction) drew several controller→model edges to the wrong collections. Verified ground truth:

| Controller | Actually uses |
|---|---|
| `productController.js` | `productModel.js` (products), `analyticsModel.js` (UserActivity, ProductPerformance, SearchAnalytics), Cloudinary SDK |
| `categoryController.js` | `categoryModel.js` (categories; subcategories are **embedded**, not a separate collection) |
| `userController.js` | `userModel.js` (users — includes embedded `addresses[]` subdocuments and `cartData` object) |
| `addressController.js` | `addressModel.js` (a **standalone** `addresses` collection written only by `POST /api/address/save`) |
| `orderController.js` | `orderModel.js`, `userModel.js`, `productModel.js`, `webhookEventModel.js`, `analyticsModel.js`, `socketService.js`, `paypalWebhookService.js`, PayPal SDK |
| `cartController.js` | `userModel.js` only — **there is no cart collection**; carts are the `user.cartData` embedded object |
| `analyticsController.js` | `analyticsModel.js`, `orderModel.js`, `productModel.js`, `userModel.js` |

### 3.3 "Cart" as a business module vs. data reality
The diagram's "Cart" box is real at the API level (`/api/cart/*`), but at the data layer the cart is **not a collection** — it is `userModel.cartData` (a free-form object keyed `productId → color → quantity`). Any diagram drawing a Cart store beside MongoDB is wrong.

### 3.4 Single "Validation, JWT and RBAC" gate
The code has **four distinct gates**, in order: (1) Helmet + CORS allowlist + rate limiting (global 1000/15 min, auth routes 20/15 min), (2) express-validator schemas on registration/login/product routes only, (3) `authUser`/`authAdmin` JWT middleware, (4) per-controller server-side checks (ownership, price integrity, status whitelists). Additionally `express-mongo-sanitize` strips NoSQL injection operators from every body. The corrected component diagram shows these as separate boundaries.

### 3.5 "Webhook verification & idempotency" is two mechanisms, not one
Verified implementation: signature verification (PayPal verify-webhook-signature API, fail-closed) **plus** a recoverable idempotency state machine on a persisted `webhookevents` collection (`processing/completed/failed/unresolved`, unique `eventId`, bounded retry budget with terminal alerting). The diagram shows one box; the sequence diagram in `CHECKOUT_PAYMENT_FLOW.md` shows the real flow.

---

## 4. Missing components (present in code, absent from the diagram)

1. **`webhookEventModel` (webhookevents collection)** — PayPal event persistence, idempotency, and manual-reconciliation audit trail.
2. **`analyticsModel`** — three collections (`UserActivity`, `ProductPerformance`, `SearchAnalytics`) backing the analytics module the diagram does label, but with no data store shown.
3. **`addressModel` (standalone `addresses` collection)** — written by `POST /api/address/save`; **not** the user address book (that is `user.addresses[]` embedded). No other code reads it; it is a legacy landing spot for the checkout address form.
4. **Startup configuration guardrails** (`config/startupValidation.js`) — fatal-on-boot checks for live PayPal credentials and production JWT secrets; environment-agreement warnings.
5. **MongoDB connection resolver** (`config/mongodb.js`) — URI validation, default-database application, ping-based readiness verification (rewritten in this stabilization phase).
6. **Debug/diagnostic endpoints** — `/api/user/debug`, `/api/orders/debug` (admin-only; hidden with 404 in production — see §6).
7. **Credential redaction layer** (`utils/redact.js`) — applied to logs and error responses.
8. **Upload staging** — multer writes to `backend/uploads/` on disk before Cloudinary upload (the diagram implies a direct browser→Cloudinary path, which does not exist).

## 5. Missing integration dependencies in the diagram

- **SMTP transport configuration** (host/port/TLS) — the email provider box has no configuration dependency shown; without `SMTP_*` the service degrades gracefully (transporter = null, emails skipped).
- **`PAYPAL_WEBHOOK_ID`** — webhook verification fails closed without it (every webhook 400-rejected).
- **Environment-variable contract overall** — see `backend/.env.example` for the authoritative, code-verified list.

## 6. Missing security boundaries (now documented in the corrected diagrams)

- CORS **allowlist** (environment-driven `FRONTEND_URL` / `ADMIN_URL` / `CORS_EXTRA_ORIGINS` + fixed dev origins; shared by Express and Socket.IO policies via `config/allowedOrigins.js`).
- Rate limiting (global + auth-specific) and health-probe exemption.
- Raw-body capture for webhook signature verification (`express.json` `verify` hook on the exact webhook path).
- Debug endpoints: production-hidden (404) via `middleware/debugGuard.js` unless `ENABLE_DEBUG_ENDPOINTS=true`.
- Admin-token rejection in shopper middleware (Phase 3 fix — previously admin tokens passed `authUser` with a null user id).
- Mongo query sanitization and regex escaping on product search.
- Graceful-shutdown drain flag (503 for non-health traffic during shutdown).

## 7. Inconsistent documentation (found and resolved)

| Document / artifact | Inconsistency | Resolution |
|---|---|---|
| `backend/package.json` `test` script | Ran `scripts/run-tests.js` (manual smoke runner requiring live MongoDB + SMTP), while the "293 tests" claim refers to the Jest suite | `test` now runs Jest; smoke runner moved to `test:smoke` |
| `backend/.env.example` `ADMIN_URL` default | `http://localhost:5177` — admin dev server actually runs on 5174 | Corrected to 5174 |
| `backend/env.example` (no dot) and `frontend/env.example` | Exhaustive legacy templates listing dozens of variables no code reads (AWS_*, REDIS_*, STRIPE_*, TWILIO_*, FCM_*, …) | Marked superseded-by-`.env.example` headers (kept for history) |
| Root-level `PAYPAL_*.md` fix reports | 20+ historical fix narratives, some describing superseded behavior | Left in place as history; `docs/architecture/*` is now authoritative |
| `frontend/index.html` og:url metadata | Points at the historical `skr-e-commerce.netlify.app` domain | Cosmetic only; noted in `KNOWN_LIMITATIONS.md` |
| Hardcoded CORS origins in `app.js` | Historical SKR Netlify production domains baked into source | Moved to environment configuration (Phase 4 fix) |

## 8. Reliability and data-integrity risks (verified handling)

| Risk | Code behavior |
|---|---|
| Concurrent checkout oversell | `findOneAndUpdate` with `stockQuantity >= qty` filter — atomic per-item reservation; partial reservations roll back on later failure |
| Duplicate checkout submissions | Optional `Idempotency-Key` header + unique **partial** index `(userId, idempotencyKey)` where key is a string; race loser replays winner's order |
| Double fulfillment from webhook + capture race | Capture amount/currency verified against order total before any write; webhook match requires capture-id or signed related-order-id; order update is idempotent; unmatched events retried within a bounded budget then alerted |
| Payment amount tampering | Server-side pricing only; client prices discarded (invalid supplied prices rejected) |
| Refunded orders clobbered by late webhook | Webhook update filter excludes non-`pending/failed` paymentStatus unless backfilling the capture id |
| Stock leak on order-save failure | **Closed 2026-10-26 (K-21):** the order draft is persisted first, each decrement carries a `<orderId>:<index>` debit marker in the same product update, the reservation is committed conditionally, and the sweep credits abandoned drafts exactly once |
| Cancel double-restore | `stockReserved` flag cleared in the same atomic update that claims the cancellation; the credit itself is exactly-once via the product `restorationCredits` ledger, retried by the sweep if it fails |
| Interrupted webhook processing | `webhookevents` state machine re-acquires `failed`/`unresolved`/stale-`processing` records; duplicates acknowledged only when `completed` |
| Crash-before-ready | Startup fails fast (config guardrails + DB ping) before `listen`; readiness endpoint reflects DB state |
| Unclean shutdown | Bounded shutdown budget; force-destroy of keep-alive sockets; non-zero exit when cleanup exceeded budget |
| Log credential leakage | `utils/redact.js` masks Mongo URIs, Bearer/Basic headers, JWT-shaped strings; production error responses are generic |

## 9. Residual architectural notes (not defects)

- **Admin console token scheme is mixed**: `token` header on orders/product pages, `Authorization: Bearer` on analytics pages. The backend accepts both — compatible, but a future cleanup could standardize.
- **`orderModel.items[].productId` is a String, not an ObjectId ref** (historical). The analytics aggregation normalizes it via `$convert` before `$lookup` (K-12 fix). Any new join must repeat this normalization.
- **PayPal `payee.email_address` is hardcoded to a sandbox business account** in `placeOrderPayPal`. In `PAYPAL_ENV=live` this must be removed/overridden (documented in `KNOWN_LIMITATIONS.md` and `DEVOPS_BASELINE.md`).
- **`userOrders` filters `isActive: true`** — orders are soft-deactivated via the flag; no endpoint currently sets it false (admin uses full `allOrders` view with the same filter).

---

## 10. Verdict

The application's implemented architecture is **consistent with the corrected diagrams** in this documentation set. The supplied GitDiagram was directionally right but wrong in the specifics listed in §3, incomplete per §4–§6, and silent on the security boundaries that this audit has now documented and (where missing) enforced in code.
