# NovaCart — Technical Architecture (As-Built TRD)

> **Status:** Reflects the repository on 2026-10-24. Complements (and defers
> to, for its scope) the Phase 1 engineering record
> [docs/devops/01-PHASE1-ARCHITECTURE.md](./devops/01-PHASE1-ARCHITECTURE.md).
>
> **Chain:** [01-PRD.md](./01-PRD.md) → [02-APP_FLOWS.md](./02-APP_FLOWS.md)
> → **this file** → [04-DATABASE_SCHEMA.md](./04-DATABASE_SCHEMA.md) →
> [05-API_REFERENCE.md](./05-API_REFERENCE.md) → [06-DEPLOYMENT.md](./06-DEPLOYMENT.md)

## 1. System context

```
                 ┌────────────────────┐        ┌────────────────────┐
   Shoppers ───▶ │ frontend/ (PWA)    │ ─────▶ │                    │
                 │ React 18 + Vite 6  │  REST  │   backend/         │──▶ MongoDB
   Operators ──▶ │ admin/             │ ─────▶ │   Node 22+ Express │──▶ PayPal REST
                 │ React 19 + Vite 6  │ Socket │   + Socket.IO      │──▶ Cloudinary
                 └────────────────────┘  .IO   │   (single process) │──▶ SMTP
                                          ───▶ └────────────────────┘
   PayPal ─────────── webhook (signature-verified) ───────────▶ backend
```

One Node process serves REST + Socket.IO on one port (`PORT`, default per
env). There is no queue, no cache layer, no reverse proxy in the repository —
those belong to the deployment layer (see [06-DEPLOYMENT.md](./06-DEPLOYMENT.md)).

## 2. Application stacks (from `package.json`, verified)

| App | Runtime | Key dependencies | Test tooling |
|---|---|---|---|
| `frontend/` | React 18.3.1, Vite 6, TypeScript 5.6, Tailwind 3.4 + daisyUI, framer-motion, `@paypal/react-paypal-js`, socket.io-client, vite-plugin-pwa (Workbox) | axios declared but **unused** (all calls are native `fetch`) | Vitest + @testing-library/react (10 files / 38 tests); **@playwright/test 1.64 — 2 real-browser E2E specs** (COD + Card checkout vs an orchestrated real stack); cypress/msw still declared+unused |
| `admin/` | React 19, Vite 6, TypeScript 5.7, Tailwind 4 (CSS-first `@import` + `@plugin daisyui`), daisyUI 5, axios, react-toastify, react-router-dom 6 | No chart library (analytics are stat cards/lists) | Vitest 5 + jsdom + @testing-library/react (13 files / 70 tests — every shipped page, chrome component and API helper covered) |
| `backend/` | Node ≥ 22 (engines), ESM (`"type":"module"`), Express 4.21, Mongoose 8, Socket.IO 4, `@paypal/checkout-server-sdk`, helmet 8, cors, express-rate-limit, express-mongo-sanitize, express-validator, multer, nodemailer, bcrypt, jsonwebtoken, cloudinary, compression, dotenv | 17 production deps, 0 unused (`audit-deps-usage.mjs`) | Jest 29 + supertest + mongodb-memory-server (41 suites / 404 tests, ESM mode) |

## 3. Backend module map

```
backend/
├── server.js            # startup orchestration + guardrails + shutdown wiring
├── app.js               # Express app (side-effect-free import for supertest)
├── config/
│   ├── mongodb.js       # connectDB — redacted logging, rethrows (no process.exit)
│   ├── cloudinary.js    # Cloudinary v2 config from env
│   ├── paypalEnv.js     # THE single PayPal environment switch (PAYPAL_ENV)
│   └── startupValidation.js  # boot-time guardrails (fatal/warning matrix)
├── routes/              # 7 routers (user, product, cart, orders, address,
│                        #   analytics, category) — see 05-API_REFERENCE
├── controllers/         # business logic per domain
├── middleware/
│   ├── auth.js          # authUser / authAdmin  ← the single auth stack
│   ├── validation.js    # express-validator chains + product form-data preproc
│   ├── debugGuard.js    # hides debug endpoints in production (404)
│   └── multer.js        # MIME allowlist + size limits + error handler
├── models/              # 7 files → 11 Mongoose models (see 04-DATABASE_SCHEMA)
├── services/
│   ├── socketService.js # JWT-authenticated Socket.IO; private rooms; null-safe emits
│   ├── reservationService.js # PayPal hold expiry + durable, retryable stock restoration
│   ├── emailService.js  # nodemailer; 6 templates; SMTP fallbacks
│   └── paypalWebhookService.js # verify-webhook-signature (fail-closed)
├── utils/
│   ├── redact.js        # URI/error/text redaction (canary-tested)
│   └── shutdownManager.js # idempotent, budget-bounded graceful shutdown
├── scripts/             # dev utilities (run-tests.js needs live DB+SMTP;
│                        #   seed/migrate/load/secret-scan/sandbox-check…)
├── templates/email/passwordReset.html   # only on-disk template
├── uploads/             # local multer spool dir (dev artifacts in repo)
└── __tests__/           # 41 jest specs + helpers.mjs (in-memory Mongo)
```

## 4. Cross-cutting architecture decisions

### 4.1 PayPal environment — single switch

`config/paypalEnv.js` is the **only** place that decides sandbox vs live:
`PAYPAL_ENV=live` is the sole path to live; anything else (including unset)
is sandbox. Both integration points (capture flow in `orderController`,
webhook verifier in `paypalWebhookService`) consume it. This closed a real
hazard where the capture path keyed off `NODE_ENV` while the verifier keyed
off `PAYPAL_ENV` (a prod deploy could capture LIVE money while verifying
webhooks against SANDBOX — every webhook 400-rejected, orders stuck
`pending`). Startup guardrails make a live-with-placeholder configuration
unbootable.

### 4.2 Authentication — two live stacks, one dead

| Stack | Exports | Used by | Token accepted |
|---|---|---|---|
| `middleware/auth.js` | `authUser`, `authAdmin` | user, product, cart, orders, category, address routers | `token` header or `Authorization: Bearer` |
| `middleware/authMiddleware.js` | `protect`, `admin` | analytics router | same |
| `middleware/adminAuth.js` | `adminAuth` | **nothing** | (would reject all admin tokens if wired) |

Semantics are identical: verify JWT with `JWT_SECRET` → user tokens carry
`{id}` and are checked against an active DB user; admin tokens carry
`{email, role:'admin', type:'admin'}`. Consolidation is a tracked backlog
item (S5/S6) — see [08-SECURITY.md](./08-SECURITY.md).

### 4.3 Webhook trust model

The webhook endpoint is the only mutation path that is both public and
dangerous. Trust chain: raw bytes (captured by `express.json` `verify`) +
five PayPal transmission headers + `PAYPAL_WEBHOOK_ID` → PayPal
`verify-webhook-signature` → fail-closed (any non-SUCCESS or any error
rejects before any DB write) → atomic acquisition on the `webhookevents`
unique index → verification of capture identity/amount/currency against the
order before any write. Full state machine: [02-APP_FLOWS.md](./02-APP_FLOWS.md)
§3.3; ops runbook: [09-OPERATIONS.md](./09-OPERATIONS.md) §5.

### 4.4 Realtime (Socket.IO)

- Same HTTP server/port as REST; namespace default.
- Handshake: client passes the JWT in `auth.token`; server verifies with
  `JWT_SECRET` (same secret as REST).
- Rooms: `user_<id>` (per shopper), `admin_room` (admin sockets), `order_<id>`
  (opened for typing indicators).
- Server→client events: `order_updated` (with `type: 'payment_update' |
  'shipping_update'` variants), `new_order`, `user_typing`, `user_stop_typing`.
- All emit helpers are null-safe: a down/uninitialized realtime layer can
  never 500 an order flow (this was a real bug fixed in Phase 1).
- `/api/socket/status` exposes the connected-user count (public info
  endpoint).

### 4.5 Analytics — inline tracking, live aggregation

Writes happen **inline in the domain controllers** (no service layer, no
queue): product views/search (productController), cart add/remove
(cartController), purchase + per-item revenue (orderController), plus a
generic `POST /api/analytics/track-activity` endpoint. Admin reads aggregate
**live from the orders collection** (`$lookup` into `products`). The
`SalesAnalytics` pre-aggregation model has no runtime writer. Consequence:
analytics correctness rides on the same request lifecycle as commerce; any
analytics failure is caught and logged so it never fails the business
operation.

### 4.6 Email

`emailService.js` (nodemailer) exposes `sendEmail` + six template methods.
Only **welcome** and **password-reset** are wired. `templates/email/
passwordReset.html` is the only on-disk template; other templates are
in-code strings with in-code fallbacks if the file read fails. The former
K-4 call-site/signature mismatch was fixed 2026-10-24
([01-PRD.md](./01-PRD.md) §5).

### 4.7 PWA (storefront)

- Build-time: `vite-plugin-pwa` generates the service worker (autoUpdate:
  new SW activates and reloads clients) + precache manifest.
- Runtime caching: fonts, PayPal button assets, Cloudinary images.
- Static `public/manifest.json` (brand "SKR Store" — legacy naming) with
  referenced-but-missing `apple-touch-icon.png` and screenshots.
- UX: install prompt component, per-platform install guide, offline overlay.
- Not implemented: push notifications, background sync.

### 4.8 Logging & redaction

There is **no logger library** (morgan/pino/winston are declared but
unused): logging is `console.log/error` routed through `utils/redact.js`
wherever errors or connection strings could appear. Guarantees (canary
tested): Mongo URIs → host-only summaries; Bearer/Basic credentials and
JWT-shaped strings scrubbed from messages and stacks; production 500s are
generic; health payloads carry booleans only. PayPal capture payloads log in
full only outside production.

### 4.9 Configuration & guardrails

26 environment variables are read at runtime by live code (inventory:
[06-DEPLOYMENT.md](./06-DEPLOYMENT.md) §3; a further 10 — `ENABLE_*`,
social-OAuth, `JWT_EXPIRES_IN`, `PERFORMANCE_SAMPLE_RATE` — are read only by
the two dead services). `config/startupValidation.js`
enforces at boot:

| Condition | Severity | Effect |
|---|---|---|
| `PAYPAL_ENV=live` + placeholder/missing `PAYPAL_CLIENT_ID`/`SECRET` | FATAL | exit 1 before any connection opens |
| `NODE_ENV=production` + missing `JWT_SECRET` | FATAL | exit 1 |
| `NODE_ENV=production` + PayPal still sandbox | WARN | loud startup warning |
| `PAYPAL_ENV=live` in non-prod | WARN | loud startup warning |
| Missing `ADMIN_EMAIL`/`ADMIN_PASSWORD` | WARN | admin login will 500 |
| Partial sandbox PayPal creds | WARN | |

Values are never logged — only variable names. This makes the classic
"deployed with template credentials" outage unbootable.

## 5. Dead code map (do not build on these)

| Path | Why dead |
|---|---|
| `backend/middleware/adminAuth.js` | Zero importers; semantics incompatible with current admin tokens |
| `backend/services/analyticsService.js` | CJS `require()` inside an ESM package; non-existent model paths; zero importers |
| `backend/services/socialAuthService.js` | Imports non-existent `models/User.js`; `ENABLE_SOCIAL_LOGIN`/OAuth vars read only here (dead); no routes |
| `productController.updateProductStock` | Exported, never routed |
| `POST /api/address/save` + `models/addressModel.js` | Authenticated but has **no frontend caller**; the real address book lives on the user document |
| `SalesAnalytics` model | No runtime writer or reader (dev script only populates activity) |
| `frontend/src/pages/AdminCategories.tsx` | Unrouted orphan (its API calls are admin-guarded and do attach the token) |
| `frontend/src/components/RealTimeOrderStatus.tsx`, `MobileBottomNav2.tsx`, `Icon.tsx`, `skr.json` | Unused components/assets |
| `admin/src/assets/CarrierIcon.tsx` + several admin icons | Unused assets |
| `frontend` cypress + msw (+ `playwright` plain package) | Declared-but-unused test deps; `@playwright/test` + the `test:e2e` script are REAL since 2026-10-24 (see 07-TESTING_PLAN §2c) |

## 6. Known architectural gaps (accepted, tracked)

1. **No reverse proxy / TLS termination in repo** — deployment-layer concern
   (current practice: see [06-DEPLOYMENT.md](./06-DEPLOYMENT.md)).
2. **No queue/background jobs** — email and analytics ride the request
   lifecycle; webhook retries ride PayPal's redelivery.
3. **No cache** — product list hits MongoDB every request (global rate limit
   and pagination are the only protections).
4. **Single process** — Socket.IO rooms and the drain/shutdown design assume
   one instance; horizontal scaling is future DevOps scope.
5. **Stock is informational** — order placement does not decrement
   `stockQuantity` nor block on zero (K-5).
6. **`uploads/` spool dir committed** with 77 dev images — Cloudinary is the
   real store; the dir is transient residue and should be gitignored.
