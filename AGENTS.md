# AGENTS.md — NovaCart Repository Guide for AI Agents & Engineers

> Read this before touching the repository. It reflects the code **as
> verified on 2026-10-24** and exists to stop the two classic failure modes
> on this codebase: **believing aspirational docs** and **building on dead
> code**. Human-oriented overview: root `README.md`. Full doc map in §1.

## 1. Documentation map

**Authoritative as-built set (`docs/`):**

| Doc | Content |
|---|---|
| [docs/01-PRD.md](docs/01-PRD.md) | Feature catalog with status labels; known defects K-1…K-12; non-goals |
| [docs/02-APP_FLOWS.md](docs/02-APP_FLOWS.md) | Shopper/admin/system flows as traced through source |
| [docs/03-TECH_ARCHITECTURE.md](docs/03-TECH_ARCHITECTURE.md) | Stacks, module map, cross-cutting decisions, **dead-code map** |
| [docs/04-DATABASE_SCHEMA.md](docs/04-DATABASE_SCHEMA.md) | 11 MongoDB collections, fields, indexes, references |
| [docs/05-API_REFERENCE.md](docs/05-API_REFERENCE.md) | 45 + 5 endpoints, conventions, Socket.IO events |
| [docs/06-DEPLOYMENT.md](docs/06-DEPLOYMENT.md) | CURRENT (manual) vs PLANNED (roadmap); real env vars; PayPal setup |
| [docs/07-TESTING_PLAN.md](docs/07-TESTING_PLAN.md) | Test inventory, **command truth table**, traceability matrix, gaps |
| [docs/08-SECURITY.md](docs/08-SECURITY.md) | Auth model, fixed vulns, risk register S1–S7, secrets rules |
| [docs/09-OPERATIONS.md](docs/09-OPERATIONS.md) | Health/shutdown, webhook ops runbook, incident playbook |

**Preserved Phase 1 engineering records (`docs/devops/01…09`, read-only
history, accurate for their scope):** architecture, security baseline,
reliability, testing, completion report, webhook-fix rationale, credential
rotation runbook, PayPal sandbox validation checklist, and the go-live
gates execution report (2026-10-24 — rotation/validation status).

**Current pre-DevOps gate:**
[docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md](docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md)
— executed 2026-10-26: 36 backend suites / 359 tests, 23 storefront files /
118 tests, 13 admin files / 70 tests, 13 real-browser E2E tests, plus the load
baseline artifact. Read it before planning DevOps Phase 01.

**Everything else at the repo root is HISTORY, not truth** (see §6).

## 2. Repository layout

```
NovaCart/
├── frontend/   # React 18 + Vite 6 PWA storefront (TypeScript, Tailwind 3)
├── admin/      # React 19 + Vite 6 operator dashboard (Tailwind 4, daisyUI 5)
├── backend/    # Node ≥22 ESM Express + Mongoose + Socket.IO (single process)
├── docs/       # authoritative as-built set (§1)
├── docs/devops/# Phase 1 engineering records (preserved)
└── ~30 root-level *.md history files + dev scripts (§6 — do not trust)
```

## 3. Command truth table (verified — copy these, not package.json)

```bash
# Backend regression suite — THE canonical gate (36 suites / 359 tests)
cd backend && npm run test:security
# equivalent: node --experimental-vm-modules node_modules/.bin/jest --runInBand

cd backend && npm run lint            # clean
cd backend && npm run build           # real syntax check (node --check over 90 files)
cd frontend && npm run lint && npm run type-check && npm run test -- --run   # 23 files / 118 tests (vitest 5)
cd frontend && npm run build          # PWA build
cd frontend && npm run test:e2e       # real-browser E2E (Playwright, 2 spec files / 13 tests: COD + Card + UI audit)
cd admin && npm run test -- --run     # 13 files / 70 tests (vitest 5)
cd admin && npm run lint && npm run type-check && npm run build

# All three dev servers
cd backend  && npm run dev            # API + Socket.IO
cd frontend && npm run dev            # storefront
cd admin    && npm run dev            # admin panel (port 5174)
```

**Do NOT run / do NOT trust:**

| Command | Why |
|---|---|
| `cd backend && npm test` | **Alias of the Jest regression suite since 2026-10-25** (not a separate infra runner). The live-MongoDB/SMTP smoke runner is `npm run test:smoke` — never use it as a gate |
| `npx jest` (plain) | Fails on ESM spec imports — use the `--experimental-vm-modules` form |
| `frontend` `test:e2e:ui` | Playwright UI mode needs a display; plain `test:e2e` IS the headless/CI path and is real since 2026-10-24 (Playwright vs a real backend, see docs/07 §2c; first run downloads the Chromium binary). Ports are overridable: `E2E_PORT=3101 E2E_WEB_PORT=5273 npm run test:e2e` |
| `admin` `npm test` (watch mode) | Exists but watch-mode — use `npm run test -- --run` in CI |
| `npm run security:audit` | Read-only `npm audit` since 2026-10-26 (the old `npm audit fix` mutated the tree) |

**Fixed 2026-10-25 (K-7):** `db:seed` → `scripts/seedCategories.js`,
`db:migrate` → `scripts/migrateOrders.js`, `email:test` → the real
`scripts/test-email.js` (SMTP verify; sends only with `TEST_EMAIL_TO` set),
`admin` now has a `type-check` script, and the no-op `postinstall`
(patch-package) was removed.

## 4. Environment variables (the only real ones)

**Backend (30):** `NODE_ENV, PORT, MONGODB_URI, MONGODB_DB (optional),
JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PAYPAL_ENV, PAYPAL_CLIENT_ID,
PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, WEBHOOK_PROCESSING_LOCK_MS,
WEBHOOK_MAX_UNMATCHED_ATTEMPTS, SHUTDOWN_TIMEOUT_MS, FRONTEND_URL,
ADMIN_URL, CORS_EXTRA_ORIGINS (optional), SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASS, SMTP_SECURE, SMTP_ALLOW_SELF_SIGNED, EMAIL_FROM, EMAIL_FROM_NAME,
APP_NAME, CLOUDINARY_NAME, CLOUDINARY_API_KEY, CLOUDINARY_SECRET_KEY,
ENABLE_DEBUG_ENDPOINTS (optional)`.
**Frontend (2):** `VITE_BACKEND_URL`, `VITE_PAYPAL_CLIENT_ID`.
**Admin (1):** `VITE_BACKEND_URL`.

`backend/.env.example` now documents **exactly** these (created 2026-10-26;
the file the legacy templates pointed at had been missing): all 30 runtime
vars, grouped, with code-verified defaults. `MONGODB_DB`,
`CORS_EXTRA_ORIGINS` and `ENABLE_DEBUG_ENDPOINTS` are optional and default to
`e-commerce` / empty / `false`. The old template's ~60 aspirational vars
(Stripe, Razorpay, OAuth, Redis, Twilio, FCM…) are gone. The dead
`services/analyticsService.js` (which read `ENABLE_ANALYTICS` /
`PERFORMANCE_SAMPLE_RATE` and required nonexistent model files) was removed
in the same hygiene pass — the live analytics endpoints need no
configuration. Note the Cloudinary names: `CLOUDINARY_NAME` /
`CLOUDINARY_SECRET_KEY` (not `-CLOUD_NAME` / `-API_SECRET`).
`PAYPAL_ENV=live` is the **only** path to live PayPal (`config/paypalEnv.js`);
boot guardrails exit 1 on live+placeholder creds or prod-without-JWT_SECRET.

## 5. Terminology & content rules (mandatory for anything you write here)

1. **Product name: NovaCart.** Legacy names (`SKR E-Commerce`, `SKR Store`,
   `Apple Store`, `AppleOnlineStore`, `E-commerce Store`) must not be
   introduced in new content; when describing them, mark them historical.
2. **MongoDB vocabulary only**: collections/documents/fields/references/
   indexes. Never "table", never "migration" (there is no migration
   framework — schema is code-first via Mongoose).
3. **Status labels** for any capability claim: Implemented / Partial /
   Planned / Blocked / UNVERIFIED / Deprecated (legend in `docs/01-PRD.md`
   §2). Never present aspirational code as working.
4. **No secrets, ever** — not in docs, not in examples, not in logs. PayPal
   client **id** is public-by-design; its secret is not.
5. Mocked ≠ real: PayPal behavior is automated-tested **only through
   mocks**; live sandbox validation is UNVERIFIED until the
   `docs/devops/08` checklist is executed.

## 6. Root-level files: what is history, what is truth

| Path | Status |
|---|---|
| `AGENTS.md`, `README.md`, `DEPLOYMENT_CHECKLIST.md` (warning header), `docs/**` | **Truth** (maintained) |
| `docs/devops/**` | **Truth, preserved** (Phase 1 records — do not edit; supersede via `docs/`) |
| `PAYPAL_*.md`, `ANALYTICS_README.md`, `AUTHENTICATION_FEATURES.md`, `UI_UX_*.md`, `SETUP_*.md`, `COMPREHENSIVE_SETUP_GUIDE.md`, `loading-issue-fix.md`, `cart-persistence-solution.md`, `SECURITY_GATE_PLAN.md` (except when referenced as the S1 procedure source), `PHASE1_LINTING_TESTING_REPORT.md` | **History** — troubleshooting narratives from development; several contain statements that no longer match the code; some previously contained real secrets (since placeholdered) |
| `test-*.js`, `check-admin-users.js`, `debug-admin-auth.js`, `verify-paypal-capture.js`, `websocket-control.sh` (root) | **Dev scripts** — run nothing blindly; `verify-paypal-capture.js` reads PayPal creds from env |

When a history file contradicts `docs/`, **`docs/` wins.**

## 7. Known traps (things that look like features but aren't)

1. **COD/Card checkout order creation is real since 2026-10-24** (K-1
   fixed): `PlaceOrder.tsx` POSTs to `/api/orders` (UI keys `cod`→`'COD'`,
   `stripe`→`'Card'`); the backend whitelists `COD|Card` (400
   otherwise) — `PayPal` is deliberately rejected there so PayPal orders must
   be created through `/api/orders/paypal/create` with a `paypalOrderId` the
   webhook can match. Card is **gateway-less** — orders land `paymentStatus:'pending'`
   and the store collects manually.
2. **"stripe" fallback is not a gateway** — auto-switched after PayPal
   currency/seller/country errors; it creates a pending `Card` order, not an
   online card payment.
3. **PayPal client-id has no fallback** (K-2 fixed 2026-10-25):
   `PlaceOrder.tsx` reads `import.meta.env.VITE_PAYPAL_CLIENT_ID || ""` —
   unset renders an explicit "PayPal payments are unavailable" state
   instead of pointing at the wrong PayPal app. Always set it in production.
4. **Dead code — deleted 2026-10-25, do not resurrect** (all verified
   zero-importer): `backend/middleware/adminAuth.js`,
   `backend/services/analyticsService.js` (its requires pointed at
   nonexistent model files), `backend/services/socialAuthService.js`,
   `skr.json`, FE `AdminCategories.tsx`, `RealTimeOrderStatus.tsx`,
   `MobileBottomNav2.tsx`, `Icon.tsx`, admin `CarrierIcon.tsx`.
   Still present but unrouted (do not import, do not "fix" by wiring
   without owner approval): `productController.updateProductStock`, the
   legacy `POST /api/address/save` endpoint (routed server-side, no
   storefront caller since K-11; `addressModel` is live via the authz
   spec).
5. **User schema 2FA/biometric fields are vestigial** — no code path uses
   them; social-login buttons are unwired.
6. **Address mutation URL contract** (K-11 fixed 2026-10-24): every
   storefront mutation now uses the routed plural endpoints — add `POST
   /api/user/addresses`, edit `PUT /api/user/addresses/:addressId` (fields
   only; never put the id in the body), delete `DELETE
   /api/user/addresses/:addressId`, set-default `PUT
   /api/user/addresses/default`. The singular `/api/user/address…` path is
   unrouted — do not reintroduce it (locked by `AddressBook.test.tsx`).
7. **Order placement decrements stock atomically** (K-5 fixed 2026-10-25):
   reservation + oversell floor 0 + cancel-restore, locked by
   `inventoryPricingIntegrity` and R-4 race specs. `stockQuantity` is no
   longer merely informational.
8. **Single auth stack** (K-9 consolidated 2026-10-25): `middleware/auth.js`
   exports `authUser`/`authAdmin` (+ default). The duplicate
   `authMiddleware.js` (`protect`/`admin`) is gone; its one importer
   (analyticsRoute) aliases the canonical names. Do not fork it again.
9. **Dependency graphs are clean** (K-10 fixed 2026-10-25): `axios` removed
   from backend + frontend (admin uses it legitimately); 52 dead declarations
   gone. Keep it that way — run `node scripts/audit-deps-usage.mjs` (all
   three apps) before adding any dependency.
10. **Orders embed snapshots** (`items[]`, `address`) — updating a product
    or address never rewrites history; never "repair" old orders by joining
    to current catalog data.
11. **Sales-analytics `categoryBreakdown` joins through a type conversion**
    (K-12 fixed 2026-10-24): order items store `productId` as a **string**
    while `products._id` is an ObjectId — the aggregation normalizes the
    join key via `$convert` (onError/onNull null) before the `$lookup`.
    Never join the raw `items.productId` to `products._id` directly, and
    keep the robustness case (garbage id must not 500 the report) green in
    `analyticsAggregation.spec.js`.
12. **Test-writing trap — auth rate limiter**: every route under
    `/api/user/*` shares the `authLimiter` (20 requests / 15 min / IP) and
    jest gives each spec file a fresh app instance, so keep each spec
    file's `/api/user/*` request count under 20 or later requests 429.
13. **Test-writing trap — admin pages render duplicate nodes**: the admin
    List/Orders pages render mobile + desktop layouts side by side
    (`lg:hidden` / `hidden lg:flex`), so product names and delete buttons
    appear TWICE in jsdom (CSS never hides DOM nodes). Use `getAllBy*` and
    index, or assert on unique chrome. Likewise, RTL `getByText` matches
    only an element's DIRECT text nodes — split JSX (e.g.
    `<p><span>Method:</span> PayPal</p>`) never matches 'Method: PayPal'.

## 8. Rules of engagement for changes

1. **Regression gate before any merge:** `cd backend && npm run
   test:security` + frontend lint/type-check/test/build + admin
   lint/type-check/test/build (admin gate: 13 files / 70 tests; the shipped
   admin surface is fully covered). Baseline evidence and numbers:
   [docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md](docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md).
2. **Webhook changes are high-risk**: extend the state-machine specs
   (`webhookIdempotency`, `webhookUnmatchedCapture`,
   `captureEndpointVerification`) alongside any behavior change. The
   regressions these encode were real, production-class bugs.
3. **Never log or return secret material**; route errors through
   `utils/redact.js`; keep production 500s generic.
4. **Preserve fail-closed semantics** on the webhook (signature → structural
   validation → atomic acquisition → verification gates → then, and only
   then, order writes).
5. Schema changes are code-first: edit the model, ship code that tolerates
   old documents (no migration framework exists).
6. Update `docs/` in the same change when behavior changes — these files are
   the as-built contract, and their accuracy is a feature.
