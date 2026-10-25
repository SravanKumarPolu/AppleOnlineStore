# NovaCart

A full-stack e-commerce system: **storefront PWA + admin dashboard + REST/realtime API**, built for a consumer-electronics catalog (iPhone, iPad, Mac, Watch, AirPods, Accessories) with **PayPal** as the integrated payment method.

> **Naming:** this project's official name is **NovaCart**. You may still find
> legacy branding (`SKR E-Commerce`, `Apple Store`) in older assets and page
> copy — those are historical; see `AGENTS.md` §5.
>
> **Documentation:** everything in [`docs/`](docs/) is as-built and verified.
> The ~30 other root-level `*.md` files are development history and may be
> outdated — when in doubt, `docs/` wins.

## What works today (short version)

- **Storefront** (`frontend/`): catalog + search + category filters, product
  detail, cart (color variants, guest → server sync), address book, PayPal
  checkout, order history with realtime status updates, installable PWA with
  offline overlay.
- **Admin** (`admin/`): env-credential login, product add/remove (Cloudinary
  images), order fulfillment (6-status lifecycle), analytics views
  (dashboard / sales / products / users / search).
- **Backend** (`backend/`): Express + Mongoose + Socket.IO, JWT auth with
  account lockout, signature-verified PayPal webhooks with a recoverable
  idempotency state machine, health endpoints, graceful bounded shutdown,
  boot-time configuration guardrails, log redaction, shared CORS allowlist,
  credential-safe MongoDB connection resolver. **35 test suites /
  355 tests passing.**

### Known limitations (documented, not hidden)

- **COD and Card checkout create real orders** (fixed 2026-10-24, K-1):
  COD/Card submit through `POST /api/orders` as `paymentStatus:'pending'`
  orders. Card remains gateway-less — it records the intent; the store
  collects the payment manually. Details: `docs/01-PRD.md` §5.
- Password-reset emails render correctly (K-4 fixed 2026-10-24 — greeting by
  name, working `FRONTEND_URL`-based link).
- Address saves from the storefront UI work end-to-end (K-11 fixed
  2026-10-24 — every mutation caller now uses the routed plural
  `/api/user/addresses…` endpoints, locked by component specs).
- The sales-analytics `categoryBreakdown` aggregates real product categories
  (K-12 fixed 2026-10-24 — the `$lookup` now normalizes string product ids to
  ObjectId before joining, with garbage ids skipped safely).
- Orders do not decrement stock (K-5); the admin panel has no mobile
  navigation (K-6) — its test coverage is complete for the shipped surface
  (auth chrome, dashboard, Orders/Add/List, the four analytics pages and
  the Sidebar; 12 files / 65 tests since 2026-10-25).
- Live PayPal end-to-end is **UNVERIFIED** until the sandbox checklist runs
  (`docs/devops/08-…`); credential rotation is partially done — `JWT_SECRET`
  + admin credentials rotated 2026-10-24, provider credentials pending owner
  action (`docs/devops/07-…`, `docs/devops/09-…`). Full list: `docs/01-PRD.md` §5.

## Quick start

```bash
# 1) Backend
cd backend
cp .env.example .env      # fill MONGODB_URI, JWT_SECRET, ADMIN_EMAIL/PASSWORD,
                          # PAYPAL_* (sandbox ok), SMTP_*, CLOUDINARY_*
npm install
npm run dev               # API + Socket.IO

# 2) Storefront
cd frontend
cp .env.example .env      # VITE_BACKEND_URL, VITE_PAYPAL_CLIENT_ID
npm install
npm run dev

# 3) Admin
cd admin
cp .env.example .env      # VITE_BACKEND_URL
npm install
npm run dev               # port 5174
```

The backend refuses to boot with fatal misconfigurations (e.g. live PayPal
credentials that are placeholders, or production without `JWT_SECRET`) —
that is by design; the startup report names the variables (never values).

## Testing

```bash
cd backend  && npm test                # canonical regression gate (35 suites / 355 tests)
cd backend  && npm run verify:startup  # boots real server vs in-memory Mongo; readiness + graceful shutdown
cd frontend && npm run test -- --run    # 57 vitest tests (12 files)
cd admin    && npm run test -- --run    # 70 vitest tests (13 files)
cd frontend && npm run test:e2e         # 13 real-browser E2E tests (checkout + UI audit)
```

⚠️ `cd backend && npm run test:smoke` is a different thing (needs a live
MongoDB + SMTP) — not the regression suite. Full command truth table:
`docs/07-TESTING_PLAN.md` §3. The E2E run boots the real backend against an
in-memory MongoDB plus the vite dev server (first run downloads the
Playwright Chromium binary). Latest executed results:
`docs/testing/FINAL_TEST_EXECUTION.md`.

## Documentation map

| Doc | Content |
|---|---|
| [`docs/01-PRD.md`](docs/01-PRD.md) | Features with status labels + known defects |
| [`docs/02-APP_FLOWS.md`](docs/02-APP_FLOWS.md) | Shopper/admin/system flows |
| [`docs/03-TECH_ARCHITECTURE.md`](docs/03-TECH_ARCHITECTURE.md) | Stacks, module map, dead-code map |
| [`docs/04-DATABASE_SCHEMA.md`](docs/04-DATABASE_SCHEMA.md) | 11 MongoDB collections |
| [`docs/05-API_REFERENCE.md`](docs/05-API_REFERENCE.md) | 45+5 endpoints, Socket.IO events |
| [`docs/06-DEPLOYMENT.md`](docs/06-DEPLOYMENT.md) | Current manual deployment + roadmap |
| [`docs/07-TESTING_PLAN.md`](docs/07-TESTING_PLAN.md) | Tests, commands, traceability |
| [`docs/08-SECURITY.md`](docs/08-SECURITY.md) | Security model + risk register |
| [`docs/09-OPERATIONS.md`](docs/09-OPERATIONS.md) | Health, webhook ops, incidents |
| [`docs/architecture/`](docs/architecture/) | **Pre-DevOps audit + corrected diagrams** (system, components, database, auth, checkout/payment, DevOps baseline) |
| [`docs/testing/`](docs/testing/) | **Final test execution, security regression, known limitations, pre-DevOps readiness** |
| [`docs/devops/`](docs/devops/) | Phase 1 engineering records (preserved) |
| [`AGENTS.md`](AGENTS.md) | Repo guide for AI agents & engineers |

## Status

Phase 1 (security, reliability, testing) is complete with a **CONDITIONAL
GO** for production. Go-live gates partially executed (2026-10-24):
`JWT_SECRET` + admin credentials rotated and live-verified, all
locally-provable validation items green
([`docs/devops/09-GO-LIVE-GATES-EXECUTION.md`](docs/devops/09-GO-LIVE-GATES-EXECUTION.md)).
Still gated on owner actions: provider-credential rotations + canonical-repo
git history purge, and the real-PayPal sandbox validation round
(`docs/devops/08-…`). Docker/CI/monitoring are planned roadmap work, not
present in this repository (`docs/06-DEPLOYMENT.md` §6).

**Pre-DevOps stabilization (2026-10-26): COMPLETE — READY for the DevOps
phase.** Full audit, fixes (MongoDB connection resolver, admin-token boundary
in shopper middleware, environment-driven CORS, production-hidden debug
endpoints, credential redaction in legacy scripts) and verified outcomes:
[`docs/testing/PRE_DEVOPS_READINESS.md`](docs/testing/PRE_DEVOPS_READINESS.md).
