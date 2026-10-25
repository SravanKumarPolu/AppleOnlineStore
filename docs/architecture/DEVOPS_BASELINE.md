# DevOps Baseline — What Exists Today and What DevOps Must Provide

**Purpose:** the hand-off contract for the DevOps implementation phase. Everything in §1 is **implemented and verified** in this repository. Everything in §2 is **required** and explicitly **not implemented** in this stabilization phase (no Docker, Kubernetes, Terraform, Jenkins, GitHub Actions, or AWS resources were introduced, per the task restrictions).

---

## 1. Implemented baseline (verified 2026-10-26)

### 1.1 Runtime contract

| Aspect | Value |
|---|---|
| Backend runtime | Node.js >= 22 (`engines`), ESM modules, no build step |
| Frontend | React 18 + Vite 6 + TypeScript; `npm run build` → `dist/` (PWA precache ~103 entries) |
| Admin | React 19 + Vite 6 + TypeScript; `npm run build` → `dist/` |
| Listen | `0.0.0.0:$PORT` (default 3001) |
| Database | MongoDB; `MONGODB_URI` (complete URI respected) or bare host + `MONGODB_DB` (default `e-commerce`) |
| Config | Environment variables only — authoritative list: `backend/.env.example` |

### 1.2 Health probes (Kubernetes-ready semantics)

- `GET /health/live` — 200 always (process liveness; no dependency checks).
- `GET /health/ready` — 200 iff `mongoose.connection.readyState === 1` **and** not draining; 503 otherwise. Probes are exempt from rate limiting.
- During graceful shutdown the drain flag makes readiness 503 for the whole window so load balancers stop routing.

### 1.3 Lifecycle

- Startup order: config guardrails (fatal → exit 1) → MongoDB connect + ping verify → Cloudinary config → Socket.IO init → listen.
- Graceful shutdown: `SIGTERM`/`SIGINT` → drain (503 non-health) → close HTTP (budget-bounded, force-destroy keep-alives) → close Socket.IO → close MongoDB → exit 0; budget exceeded → exit 1 + alert log.
- `unhandledRejection` logged (redacted); `uncaughtException` logged + exit 1.

### 1.4 Observability hooks (log-based, no external stack yet)

- Credential-safe logging everywhere (`utils/redact.js`): Mongo URIs, Bearer/Basic headers, JWT-shaped strings are masked in logs **and** non-production error responses.
- Structured alert line `🚨 PAYMENT WEBHOOK ALERT [<reason>] {json}` for webhook outcomes needing human attention (amount/currency mismatch, capture/order mismatch, unmatched-retry-budget exhausted) — grep/alert-rule friendly.
- Startup configuration report names missing/placeholder variables without values.

### 1.5 Security baseline

- Helmet (CSP: self scripts, inline styles allowed, https images), HSTS via helmet defaults.
- CORS allowlist shared by Express + Socket.IO (`config/allowedOrigins.js`): dev origins fixed (localhost:3000/5173/5174), production origins env-driven (`FRONTEND_URL`, `ADMIN_URL`, `CORS_EXTRA_ORIGINS`); credentials enabled, exact-match only (no wildcard).
- Rate limiting: global 1000 req/15 min/IP; auth endpoints 20 req/15 min/IP; health probes exempt.
- JWT auth with role separation (shopper vs admin issuance paths); admin tokens rejected on shopper routes; tokenVersion-based session invalidation.
- Input hardening: express-validator schemas, mongo-sanitize, regex-escaped search, JSON body cap (10 MB), multer image whitelist + 5 MB/4-file caps.
- PayPal webhook signature verification fail-closed; capture amount/currency verification; idempotent event state machine.
- Debug endpoints hidden in production (404) unless `ENABLE_DEBUG_ENDPOINTS=true`.
- No secrets in the repository (audited; legacy hardcoded credentials in root debug scripts were redacted in this phase — rotate historical values, see `SECURITY_REGRESSION.md`).

### 1.6 Quality gates (commands for CI to reuse)

| Gate | Command (cwd) | Current status |
|---|---|---|
| Backend tests | `npm test` (backend) — Jest, 355 tests | PASS |
| Backend lint | `npm run lint` (backend) | PASS |
| Backend startup verification | `npm run verify:startup` (backend) | PASS |
| Frontend unit tests | `npx vitest run` (frontend) — 57 tests | PASS |
| Frontend build + typecheck | `npm run build` (frontend, runs `tsc -b`) | PASS |
| Frontend lint | `npm run lint` (frontend) | PASS |
| Admin unit tests | `npx vitest run` (admin) — 70 tests | PASS |
| Admin build + typecheck | `npm run build` (admin) | PASS |
| Admin lint | `npm run lint` (admin) | PASS |
| Browser E2E | `npx playwright test` (frontend) — 13 tests, boots real backend + in-memory Mongo | PASS |
| Dependency audit | `npm audit` (each package) | backend 0 · admin 0 · frontend 3 moderate (build-time only) |
| Load baseline | `node scripts/load-test.mjs` (backend) | PASS (see `FINAL_TEST_EXECUTION.md`) |

---

## 2. Required from the DevOps phase (not implemented here)

1. **Containerization**: Dockerfiles for backend (Node 22 runtime, non-root user, `NODE_ENV=production`, `CMD node server.js`) and static builds (frontend/admin via nginx or CDN). The repo currently contains **no** Dockerfile/compose — the `frontend/Dockerfile` reference in historical notes does not exist in the tree (verified).
2. **Secrets management**: external secret store for `JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `MONGODB_URI`, `PAYPAL_CLIENT_ID`/`SECRET`/`WEBHOOK_ID`, `SMTP_*`, `CLOUDINARY_*`, `FRONTEND_URL`/`ADMIN_URL`. Rotation runbook: `docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md`.
3. **TLS termination** in front of the API and the static hosts (CORS origins must then be the public HTTPS origins).
4. **Orchestration**: liveness probe `/health/live`, readiness probe `/health/ready`, `SIGTERM`-honoring termination grace ≥ `SHUTDOWN_TIMEOUT_MS` (default 10 s).
5. **Multi-replica consideration**: Socket.IO uses the in-memory adapter — sticky sessions or a Redis adapter is required before scaling to > 1 backend replica (room membership and the connected-users map are per-process).
6. **Managed MongoDB** with the `e-commerce` database (or a complete URI pointing at the chosen database) + backups. Connection string must be passed complete or as a bare host (the resolver applies the default db).
7. **CI/CD pipeline** running the quality-gate commands above on every PR; blocking on any FAIL.
8. **Log aggregation + alerting** keyed on the `PAYMENT WEBHOOK ALERT` lines and the shutdown-forced-exit log.
9. **PayPal go-live prerequisites** (see `docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`): live credentials, `PAYPAL_ENV=live`, **removal/override of the hardcoded sandbox payee email in `orderController.placeOrderPayPal`** (`sb-business@business.example.com` — currently pinned for sandbox compatibility), public HTTPS webhook URL registered with PayPal, and end-to-end live validation. `startupValidation.js` makes live-with-placeholder-credentials a fatal boot error, so this cannot be half-configured silently.
10. **Frontend dependency upgrade window**: tailwindcss 3 → 4 (clears the 3 moderate build-time audit findings; breaking change — needs a dedicated visual-regression pass).

---

## 3. Environment variable contract (backend)

See `backend/.env.example` — every variable listed there is read by the code (verified). Summary of operational criticality:

| Variable | Failure mode when missing/placeholder |
|---|---|
| `MONGODB_URI` | fatal at startup (clear error) |
| `JWT_SECRET` | fatal in production; all auth fails |
| `PAYPAL_CLIENT_ID`/`SECRET`/`WEBHOOK_ID` | fatal when `PAYPAL_ENV=live`; warnings otherwise |
| `ADMIN_EMAIL`/`ADMIN_PASSWORD` | admin login unavailable (500 on `/api/user/admin`) |
| `FRONTEND_URL`/`ADMIN_URL`/`CORS_EXTRA_ORIGINS` | only dev origins allowed (browser apps on other origins blocked) |
| `SMTP_*` | email flows degrade gracefully (transporter null, order flows unaffected) |
| `CLOUDINARY_*` | product image upload/remove fail (product add/remove unavailable) |
| `SHUTDOWN_TIMEOUT_MS`, `WEBHOOK_*` | tuning knobs with safe defaults |
