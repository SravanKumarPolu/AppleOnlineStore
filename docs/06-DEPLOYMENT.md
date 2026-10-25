# NovaCart — Deployment Guide

> **Status:** CURRENT describes how the repository actually deploys today
> (verified 2026-10-24). PLANNED describes the agreed DevOps roadmap —
> nothing in that section exists in the repository yet. This guide
> complements the operational checklists
> [docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md](./devops/07-CREDENTIAL-ROTATION-RUNBOOK.md)
> and [docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md](./devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md).
>
> **Chain:** … → [05-API_REFERENCE.md](./05-API_REFERENCE.md) → **this file**
> → [07-TESTING_PLAN.md](./07-TESTING_PLAN.md)

## 1. CURRENT deployment model (as the repo stands)

**Manual, single-process, no container/CI artifacts.** The repository
contains **no** Dockerfile, docker-compose, GitHub Actions workflow,
Terraform, or process-manager config. What exists:

- `backend/` — Node process started directly (`node server.js` / `npm start`
  via nodemon in dev). Serves REST + Socket.IO on one port.
- `frontend/` and `admin/` — Vite static builds (`npm run build` → `dist/`)
  to be served by any static host / reverse proxy. The CORS allowlist
  hardcodes two legacy Netlify origins (`skr-e-commerce.netlify.app`,
  `admin-skr-e-commerce.netlify.app`) plus `FRONTEND_URL`/`ADMIN_URL` env
  values — historical remnants of a previous hosting setup.
- `DEPLOYMENT_CHECKLIST.md` (root) — generic template with an accurate
  environment section; treat non-env sections as generic guidance, not
  as-built fact.

### 1.1 Prerequisites

| Dependency | Purpose | Notes |
|---|---|---|
| Node.js ≥ 22 | backend runtime | engines-enforced |
| MongoDB | primary datastore | Atlas or self-hosted |
| PayPal app (sandbox or live) | payments | client id/secret + webhook id |
| Cloudinary account | product images | `CLOUDINARY_*` keys |
| SMTP account | transactional email | e.g. any SMTP provider |

### 1.2 Build & run

```bash
# Backend
cd backend
cp .env.example .env          # then fill REAL values (see §3)
npm install
npm run test:security         # regression gate (36 suites / 359 tests)
node server.js                # listens on 0.0.0.0:$PORT

# Storefront
cd frontend
cp .env.example .env          # VITE_BACKEND_URL, VITE_PAYPAL_CLIENT_ID
npm install
npm run build                 # PWA precache emitted
# serve dist/ behind your web server / CDN

# Admin
cd admin
cp .env.example .env          # VITE_BACKEND_URL
npm install
npm run build
# serve dist/
```

### 1.3 Runtime wiring you must provide (deployment layer)

- **TLS termination + reverse proxy** in front of the backend (webhooks and
  capture callbacks require HTTPS in live mode).
- **Process supervision** (restart on crash; the process itself exits 1 on
  fatal misconfiguration by design).
- **Static hosting + routing** for the two `dist/` bundles (SPA fallback to
  `index.html`).
- **MongoDB backups** — nothing in the repo does this.

## 2. PayPal configuration (the part most easily gotten wrong)

1. **Environment switch:** `PAYPAL_ENV` is the **only** switch
   (`backend/config/paypalEnv.js`). `live` is the sole path to live; unset or
   `sandbox` keeps everything on sandbox. Capture flow and webhook verifier
   share it — they can never disagree.
2. **Credentials:** `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` **from the
   same environment** as `PAYPAL_ENV`. Placeholder values with
   `PAYPAL_ENV=live` make the server **exit 1 at boot** (guardrail).
3. **Webhook:** create the webhook in the PayPal dashboard for the same
   environment, subscribe at minimum to `PAYMENT.CAPTURE.COMPLETED`, point it
   at `https://<backend-host>/api/orders/paypal/webhook`, and set
   `PAYPAL_WEBHOOK_ID`. Without the webhook id the endpoint **fails closed**
   (rejects all events) rather than accepting unverified ones.
4. **Storefront:** `VITE_PAYPAL_CLIENT_ID` must be the **public client id of
   the same environment**. Note defect K-2: `PlaceOrder.tsx` falls back to a
   hardcoded sandbox id when the env var is missing — always set the env var.
5. **Validation:** before go-live, execute
   [docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md](./devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md)
   (❓ **UNVERIFIED until done** — includes deferred/unmatched captures,
   retry exhaustion, signature fail-closed, mismatch gates, race sweep,
   idempotency).

## 3. Environment variables — the real 27 (runtime-read, verified)

`backend/.env`:

| Variable | Meaning | Guardrail |
|---|---|---|
| `NODE_ENV` | `production` / anything else | prod + missing `JWT_SECRET` → exit 1 |
| `PORT` | listen port | default in code |
| `MONGODB_URI` | connection string | never logged (host-only summary) |
| `JWT_SECRET` | JWT signing secret | required in prod (fatal otherwise); 128-char recommendation |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | operator login | warn if missing (admin login 500s); **rotation required — see §5** |
| `PAYPAL_ENV` | `live` \| `sandbox` | the single switch |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal app creds | fatal if placeholder while `live` |
| `PAYPAL_WEBHOOK_ID` | webhook to verify against | webhook fails closed without it |
| `WEBHOOK_PROCESSING_LOCK_MS` | in-flight lock window (default 30000) | |
| `WEBHOOK_MAX_UNMATCHED_ATTEMPTS` | bounded retry budget (default 10) | |
| `SHUTDOWN_TIMEOUT_MS` | graceful-shutdown budget (default 10000) | |
| `FRONTEND_URL` / `ADMIN_URL` | CORS allowlist entries | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | email transport | |
| `SMTP_ALLOW_SELF_SIGNED` | accept self-signed TLS certs (dev only) | default reject — production should never enable |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | sender identity | |
| `APP_NAME` | email branding | default `E-commerce Store` (docs use NovaCart) |
| `CLOUDINARY_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_SECRET_KEY` | image hosting | exact names as read by `config/cloudinary.js` | |

`frontend/.env`: `VITE_BACKEND_URL`, `VITE_PAYPAL_CLIENT_ID` — the only two
the code reads (the second was missing from the old template; empty value
now renders an explicit "PayPal unavailable" state rather than pointing at
the wrong PayPal app — K-2).
`admin/.env`: `VITE_BACKEND_URL` (fallback `http://localhost:3001`).

`backend/.env.example` was rewritten 2026-10-25 (K-8 fix) to document exactly
these 27 runtime variables plus a clearly-marked dev/test section — the old
template's aspirational Stripe/Razorpay/OAuth/Redis/Twilio block is gone.

(Historical note: `ENABLE_ANALYTICS` / `PERFORMANCE_SAMPLE_RATE` were read
only by the dead `services/analyticsService.js` — zero importers, and its
own requires pointed at nonexistent model files, so it could never even
load. Removed 2026-10-25 in the K-10 hygiene pass; the live analytics
endpoints in `analyticsController.js` need no configuration.)

### 3.1 Startup guardrail matrix (what makes boot fail vs warn)

See [02-APP_FLOWS.md](./02-APP_FLOWS.md) §3.1 — fatal: live+placeholder
PayPal creds, prod-without-JWT_SECRET; warnings: sandbox-in-prod,
live-in-non-prod, missing admin creds, partial sandbox creds. Values are
never printed, only variable names.

## 4. Health & shutdown (for your supervision layer)

- `GET /health/live` — liveness probe target (always 200 while up).
- `GET /health/ready` — readiness probe target (503 when DB down **or during
  the entire drain window**, so load balancers reroute before connections
  drop).
- SIGTERM/SIGINT → drain (non-health 503) → ordered teardown bounded by
  `SHUTDOWN_TIMEOUT_MS`; clean exit 0, forced exit 1. Details:
  [09-OPERATIONS.md](./09-OPERATIONS.md).

## 5. Pre-production gates (owner actions — status)

| Gate | Status |
|---|---|
| Credential rotation (MongoDB, JWT_SECRET, ADMIN_PASSWORD, Cloudinary keys, PayPal secret) | 🟡 **In progress** — `JWT_SECRET` + `ADMIN_PASSWORD` rotated and live-verified 2026-10-24 ([docs/devops/09](./devops/09-GO-LIVE-GATES-EXECUTION.md)); provider credentials (PayPal secret/webhook id, MongoDB Atlas password, Cloudinary, SMTP) remain owner dashboard rotations — runbook: [docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md](./devops/07-CREDENTIAL-ROTATION-RUNBOOK.md) |
| Git history purge / re-publish | ⛔ Blocked on owner approval (procedure in `SECURITY_GATE_PLAN.md` §S1) — the leak is confined to the owner's canonical repo; this working copy and all delivered archives verified clean (docs/devops/09 §1.4). Deploying from an archive that excludes `.git` is the interim path |
| PayPal sandbox end-to-end validation | ❓ UNVERIFIED for the real-PayPal items — all locally-executable checklist items (fail-closed proofs, topology boot, full regression gate) PASS 2026-10-24 ([docs/devops/09](./devops/09-GO-LIVE-GATES-EXECUTION.md) §2); remaining items need sandbox creds + a public HTTPS host — checklist: `docs/devops/08-…` |
| npm audit advisories (backend 64 / frontend 55 / admin 22 incl. dev trees) | 📋 Remediation plan drafted, pending approval (S2) |

Phase 1 conclusion (preserved): **CONDITIONAL GO** — all code-level gates
passed (13 suites / 111 tests at that time; since grown to 36 suites / 359 tests — see `docs/devops/00-PRE-DEVOPS-QUALITY-BASELINE.md`); deployment is gated on the owner actions
above (`docs/devops/05-PHASE1-COMPLETION-REPORT.md` §7).

## 6. PLANNED — DevOps roadmap (does NOT exist yet)

Agreed direction, explicitly **not implemented** in this repository:

| Phase | Scope | Status |
|---|---|---|
| 1 | Security / reliability / testing hardening | ✅ Done (see `docs/devops/`) |
| 2 | Docker images (three apps) | 📋 Planned |
| 3 | docker-compose local orchestration | 📋 Planned |
| 4 | GitHub Actions CI (lint + tests + builds) | 📋 Planned |
| 5 | EC2 provisioning | 📋 Planned |
| 6 | Continuous deployment | 📋 Planned |
| 7 | Terraform IaC | 📋 Planned |
| 8 | Monitoring & alerting (uptime, logs, errors) | 📋 Planned |
| 9 | Kubernetes | 📋 Planned |
| 10 | Portfolio / demonstration polish | 📋 Planned |

## 7. Post-deploy verification (quick sequence)

1. `GET /health/ready` → 200 with `checks.database:true`.
2. `GET /api/socket/status` → connectedUsers ≥ 0.
3. Storefront loads, `GET /api/product/list` returns data through the
   deployed origin (CORS check).
4. Admin login works (`POST /api/user/admin`) → dashboard summary renders.
5. Sandbox PayPal round trip (if validating): create → approve → capture →
   order `paymentStatus:'completed'` → webhook record in `webhookevents`
   with `status:'completed'`.
6. `POST /api/orders/paypal/webhook` with an invalid body → 400 (fail-closed
   proof).
