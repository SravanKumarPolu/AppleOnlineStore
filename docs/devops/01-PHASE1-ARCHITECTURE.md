# Phase 1 Architecture — NovaCart

> Status: **Reflects the repository as implemented and validated on 2026-10-23,
> including the Phase 1 Final Security & Reliability Gate.**
> Scope: frontend storefront, admin dashboard, backend API. No new
> infrastructure was introduced in Phase 1 (no Docker/AWS/CI changes).

## 1. Components

| Component | Stack | Role |
|---|---|---|
| `frontend/` | React 18 + Vite 5 + TypeScript + Tailwind + PWA (vite-plugin-pwa) | Customer storefront: catalog, product detail, cart, checkout (COD + PayPal), order tracking, auth |
| `admin/` | React + Vite + TypeScript | Operator dashboard: login, product CRUD, order management (incl. order-status updates), analytics views |
| `backend/` | Node.js + Express 4 + Mongoose 8 (MongoDB) + Socket.IO | REST API, JWT auth, PayPal capture + webhook processing, email (nodemailer), analytics aggregation |

Supporting services (external, unchanged): MongoDB (Atlas or local), PayPal REST API (sandbox/live), Cloudinary (image hosting), SMTP (nodemailer transport).

## 2. Repository layout (post Phase 1)

```
NovaCart/
├── frontend/               # Vite PWA storefront (+ vitest tests, src/__tests__/)
├── admin/                  # Vite dashboard (no test infra — documented gap)
├── backend/
│   ├── app.js              # Express app: middleware, routes, health, errors (test-importable)
│   ├── server.js           # Startup orchestration + graceful shutdown lifecycle
│   ├── config/             # mongodb.js (redacted logging), cloudinary.js
│   ├── routes/             # userRoute, productRoute, cartRoute, orderRoute,
│   │                       # analyticsRoute, categoryRoute, addressRoute
│   ├── controllers/        # business logic per domain
│   ├── middleware/         # auth.js (authUser/authAdmin), authMiddleware.js,
│   │                       # validation.js, multer.js
│   ├── models/             # user, product, order, analytics, address,
│   │                       # category, webhookEvent (new, status machine)
│   ├── services/           # socketService, emailService, socialAuthService,
│   │                       # paypalWebhookService (new)
│   ├── utils/              # redact.js (new), shutdownManager.js (new)
│   ├── __tests__/          # NEW: 8 jest spec files + helpers (76 tests)
│   └── templates/email/    # passwordReset.html (+ built-in fallbacks)
└── docs/devops/            # NEW: this document set
```

## 3. Request flows

### 3.1 Storefront catalog & cart
1. Browser loads PWA → React app mounts → `ShopContext` fetches products
   (`POST /api/product/list`) and restores the cart (`POST /api/cart/get`).
2. Cart mutations (`/api/cart/add`, `/api/cart/update`, `/api/cart/sync-local`)
   persist `cartData` on the user document; guests use localStorage (see
   cart-persistence docs).
3. Final gate: all four cart routes require `authUser`, and the controller
   derives `userId` from the verified token (body `userId` ignored) — cart
   ownership can no longer be spoofed. The frontend already sent the token
   header on every cart call, so no client change was needed.

### 3.2 Authentication
- `POST /api/user/login` → bcrypt compare → JWT (7d, HS256, `JWT_SECRET`).
- Admin: `POST /api/user/admin` → env-credential login (`ADMIN_EMAIL`/`ADMIN_PASSWORD`)
  → admin JWT (1d, `type:'admin', role:'admin'`).
- Frontends send the token via the custom `token` header (or `Authorization: Bearer`).
- `middleware/auth.js`: `authUser` (any valid token + active user),
  `authAdmin` (admin-type token or DB user with role `admin`).

### 3.3 Order lifecycle
1. `POST /api/orders` (COD) or `POST /api/orders/paypal/create` (PayPal) — `authUser`.
2. PayPal: client captures → `POST /api/orders/paypal/capture` (`authUser`) →
   backend calls PayPal OrdersCapture API via `PayPalHttpClient` → order
   `paymentStatus: 'completed'`, capture id stored.
3. Async confirmation path: PayPal → `POST /api/orders/paypal/webhook`
   (signature-verified, fail-closed; recoverable idempotency state machine —
   `webhookevents.status`: processing/completed/failed with a re-acquisition
   lock window, so an interrupted or failed processing attempt is re-processed
   by the retry delivery instead of being wrongly acknowledged) →
   `paymentStatus: 'completed'` on the matching order.
4. Admin updates fulfillment: `PUT /api/orders/status` (`authAdmin`, status
   whitelist) → persisted + `socketService.sendOrderStatusUpdate` fan-out.
5. Realtime: Socket.IO namespace on the same HTTP server; authenticated
   handshake; rooms: `user_<id>`, `order_<id>`, `admin_room`.

### 3.4 Health & lifecycle (Phase 1 + final gate)
- Startup: `server.js` awaits `connectDB()` → `connectCloudinary()` →
  `socketService.initialize()` → `listen`. Any failure exits 1 (fail-fast).
- Probes: `GET /health/live` (process liveness), `GET /health/ready`
  (200/503 by mongoose connection state, **503 for the entire drain window
  even while MongoDB is still connected** — final gate), legacy `GET /health`.
- Shutdown: SIGTERM/SIGINT → drain (503 for new non-health requests,
  readiness 503) → `server.close()` → `socketService.close()` →
  `mongoose.connection.close()` → the timeout budget (default 10 s,
  `SHUTDOWN_TIMEOUT_MS`) bounds the COMPLETE http→sockets→database cleanup
  lifecycle; an http-phase timeout force-destroys lingering keep-alive
  sockets (`closeAllConnections`), later phases run with the remaining
  budget or are skipped-and-reported, and cleanup timeouts produce a
  one-time `onForceExit` notification plus a non-zero (1) process exit so
  unclean shutdowns are never mistaken for graceful ones. Duplicate signals
  are no-ops; a clean shutdown exits 0.

## 4. Dependencies (notable, versions as installed)

| Package | Version | Used for |
|---|---|---|
| express | 4.21.2 | HTTP framework |
| mongoose | 8.16.5 | ODM |
| @paypal/checkout-server-sdk | 1.0.3 | Orders + capture + **webhook verification** (Phase 1) |
| socket.io | 4.x | Realtime order updates |
| helmet / cors / express-rate-limit / express-mongo-sanitize | current | Security middleware |
| nodemailer | 6.10.1 | Transactional email |
| jest 29 / supertest 6 / mongodb-memory-server 9 | dev | Phase 1 regression suite |

Known limitation: `npm audit` reports transitive advisories across packages —
tracked in `02-SECURITY-BASELINE.md` and `../SECURITY_GATE_PLAN.md`
(remediation waves pending approval; no major upgrades in Phase 1).

## 5. Explicitly unchanged in Phase 1

Frontend and admin UI design, database schema semantics (one additive model:
`webhookevents` collection, extended with status fields in the final gate),
PayPal capture flow, and all public route contracts. The express app was
split `server.js` → `app.js` + `server.js` without changing middleware order
or routes. The only deliberate contract-level changes are the
security-mandated ones: order/category/cart/address routes now reject
unauthenticated or non-authorized callers (401/403) that previously
succeeded, production error responses no longer echo raw provider/driver
messages, and the orphaned `frontend/src/pages/AdminCategories.tsx` page
attaches the stored token to its category-add request (the only frontend
source change; no UI redesign).
