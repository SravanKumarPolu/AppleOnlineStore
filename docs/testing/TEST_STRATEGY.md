# TEST_STRATEGY — NovaCart Full-Repository QA & Production-Readiness Audit

**Version:** 1.0 (final) · **Date:** 2026-10-25 · **Owner:** QA / SDET audit engagement
**Status legend used across all `docs/testing/` reports:** `PASS` / `FAIL` / `BLOCKED` / `NOT RUN` / `NOT APPLICABLE`

---

## 1. Mission & scope

Audit the complete NovaCart monorepo (storefront `frontend/`, admin panel `admin/`, API server `backend/`), execute every applicable class of automated test, run adversarial and production-readiness checks, apply **minimal safe fixes** to confirmed defects, and re-run the regression suites to prove no damage. The engagement covers four quality lenses simultaneously: functional correctness, security, performance, and operability.

**In scope**

- All three applications' source, tests, scripts and configuration
- The MongoDB data layer (models, indexes, transactions, aggregation pipelines)
- Authentication/authorization (JWT, admin gate, account lockout, password reset)
- The commerce money path: cart → checkout (COD/Card/PayPal) → order → stock → webhook → analytics
- Dependency hygiene (`npm audit` on production trees)
- Delivery of a verified project ZIP excluding `node_modules`, `.git`, build caches, credentials and `.env` files

**Out of scope (explicitly)**

- Live PayPal sandbox/live validation (needs owner credentials + public HTTPS host — `docs/devops/08`)
- Provider-dashboard credential rotation and the owner's canonical Git-history purge (K-3, `docs/devops/09`)
- Infrastructure deployment (Docker/AWS/CI), UI redesign, dependency *major* upgrades that change architecture

## 2. Non-negotiable business invariants

These invariants define "the system works" for this engagement. Every test category below ultimately exists to protect one of them.

| # | Invariant | Enforced by (locking suites) |
|---|---|---|
| INV-1 | One legitimate payment can never produce duplicate fulfilled orders or double side-effects — even when the capture endpoint and the webhook race, or PayPal redelivers the same event concurrently | `concurrencyRaceConditions` (R-1), `webhookIdempotency`, `webhookUnmatchedCapture`, `paypalWebhook` |
| INV-2 | Stock can never oversell or go negative, under sequential *or* concurrent order placement | `inventoryPricingIntegrity` (I-1/I-2), `concurrencyRaceConditions` (R-4) |
| INV-3 | Cancelled orders restore reserved stock exactly once; DB failures never strand a reservation | `inventoryPricingIntegrity` (I-3/I-4) |
| INV-4 | Order totals are computed from trusted server-side product prices, never client-supplied prices | `inventoryPricingIntegrity` (P-1/P-2) |
| INV-5 | Unauthenticated or non-privileged callers can never mutate another user's data (cart, orders, addresses, products, categories, order status) | `cartCategoryAddressAuthorization`, `authorizationIdorAttacks`, `adminAuthorization` |
| INV-6 | Unverified/unauthenticated webhook events can never update payment or order records (fail-closed) | `paypalWebhook`, `webhookIdempotency`, `captureEndpointVerification` |
| INV-7 | Secrets never appear in logs, health payloads, error responses, or the delivered archive | `loggingRedaction`, `healthEndpoints`, `startupShutdown.integration` |

## 3. Test architecture (reuse-first)

The strategy deliberately **reuses the repository's existing infrastructure** wherever it was already sufficient (per the engagement's evaluation-first rule):

| Layer | Tooling (pre-existing devDependencies — verified before any new install) | Role |
|---|---|---|
| Backend unit/integration | Jest + Supertest + `mongodb-memory-server` (in-memory MongoDB 7.0.14) + jsdom-free ESM setup | 28 spec suites, real HTTP through the real Express app, real DB, only *network edges* mocked (PayPal HTTP client, SMTP) |
| Storefront unit | Vitest + jsdom + @testing-library/react | 12 files covering context, hooks, pages, components |
| Admin unit | Vitest + jsdom + @testing-library/react (infrastructure added 2026-10-24, ported from storefront) | 13 files — the entire shipped admin surface (incl. the K-6 mobile-nav/404 suites) |
| Browser E2E | Playwright (real Chromium) + orchestrated real stack (`backend/scripts/e2e-server.mjs` boots in-memory Mongo + real `server.js`; Vite dev server) | 13 specs: money-path checkout + full UI audit |
| Load/performance | `backend/scripts/load-test.mjs` (Node built-in `http`, no new deps) | 1→10→50→100→250 VU against the real server |
| Static quality | ESLint (backend), `tsc --noEmit` (frontend/admin), `vite build` × 2, `npm audit --omit=dev` × 3 | Gate hygiene + dependency CVEs |

**New infrastructure created this engagement (only where existing was insufficient):** the admin vitest setup (admin previously had *zero* tests), the Playwright E2E config + specs (`test:e2e` was previously fictional — K-7), the load harness, and 21 of the 28 backend suites (the repo shipped with 8). Nothing was removed; existing tests were never weakened.

## 4. Test-type coverage map (the 24 requested categories)

| # | Category | Where executed | Result home |
|---|---|---|---|
| 1 | Unit (backend) | Jest, 31 suites | TEST_EXECUTION_REPORT |
| 2 | Unit (frontend) | Vitest 12 files | TEST_EXECUTION_REPORT |
| 3 | Unit (admin) | Vitest 13 files | TEST_EXECUTION_REPORT |
| 4 | Integration (API+DB) | Supertest + in-memory Mongo (all backend suites) | TEST_EXECUTION_REPORT |
| 5 | E2E browser | Playwright vs real stack | TEST_EXECUTION_REPORT |
| 6 | Auth security | `authenticationAttacks`, `adminAuthentication`, lockout, reset specs | SECURITY_TEST_REPORT |
| 7 | Authorization/IDOR | `authorizationIdorAttacks`, `cartCategoryAddressAuthorization`, `adminAuthorization` | SECURITY_TEST_REPORT |
| 8 | Injection & web security (OWASP) | `injectionWebSecurity` | SECURITY_TEST_REPORT |
| 9 | Adversarial input validation | `adversarialInputValidation` | AGGRESSIVE_TEST_REPORT |
| 10 | Business logic (cart/checkout) | `businessLogicCartCheckout` | AGGRESSIVE_TEST_REPORT |
| 11 | Inventory/pricing integrity | `inventoryPricingIntegrity` (P/I invariants) | AGGRESSIVE_TEST_REPORT |
| 12 | Webhook replay/idempotency | `webhookIdempotency`, `paypalWebhook`, `webhookUnmatchedCapture` | AGGRESSIVE_TEST_REPORT |
| 13 | Concurrency/race conditions | `concurrencyRaceConditions` (2/10/50/100 in-flight) | AGGRESSIVE_TEST_REPORT |
| 14 | Load/performance | Load harness 1–250 VU | PERFORMANCE_TEST_REPORT |
| 15 | Frontend UX (responsive/a11y/keyboard) | Playwright `ui-audit.spec.ts` (mobile viewport, landmarks, alt text, keyboard nav) | TEST_EXECUTION_REPORT |
| 16 | Health/readiness | `healthEndpoints`, `startupShutdown.integration` | TEST_EXECUTION_REPORT |
| 17 | Graceful shutdown | `gracefulShutdown` (12) + integration (2) | TEST_EXECUTION_REPORT |
| 18 | Startup guardrails | `startupValidation` (13) | SECURITY_TEST_REPORT |
| 19 | Log redaction/secrets | `loggingRedaction` (17) | SECURITY_TEST_REPORT |
| 20 | Dependency CVEs | `npm audit --omit=dev` × 3 apps | SECURITY_TEST_REPORT |
| 21 | Static analysis/build | ESLint + tsc × 2 + builds × 2 | TEST_EXECUTION_REPORT |
| 22 | Coverage measurement | Jest/Vitest coverage | TEST_COVERAGE_MATRIX |
| 23 | Live PayPal (sandbox) | — | **NOT RUN** — owner action (`docs/devops/08`) |
| 24 | Real SMTP delivery | — | **NOT RUN** — no SMTP in sandbox (mocked at service contract level) |

Categories 23–24 are the only NOT RUN items and both are environment-gated owner actions, not test debt; the report set marks them honestly rather than simulating them.

## 5. Environments & safety rules

- **Single isolated sandbox:** 2 vCPU / 4 GB RAM, Node v24.21.0, loopback networking. The sandbox is *shared* with the test harness — a fact the performance report accounts for.
- **Database:** every automated suite runs against a disposable **in-memory MongoDB 7.0.14** (`mongodb-memory-server`), never a persistent or production DB. No destructive DB operation was ever issued.
- **Payments:** PayPal is exercised through mocked *network edges only* (stubbed HTTP client behind `setPayPalClientForTests` / `setActiveWebhookVerifier` seams); no real charge can occur. COD/Card E2E creates real orders in the disposable DB.
- **Credentials:** no real credentials exist anywhere in the test environment; `__tests__/env-setup.mjs` installs placeholders. The delivered ZIP excludes `.env`, `*.local`, `.git` (verified in §REGRESSION_REPORT delivery checks).
- **Load safety:** escalating VU levels auto-abort if error rate > 5 % or p95 > 3000 ms; 500 VU intentionally not executed on this 2-core sandbox (documented decision, PERFORMANCE_TEST_REPORT §limitations).

## 6. Defect workflow (the 5 rules)

1. **Confirm before fixing** — a defect only enters the register with a reproducing test or a command transcript.
2. **Minimal safe fix** — no assertion weakening, no test deletion, no opportunistic refactors; architecture/API/UI/DB compatibility preserved.
3. **Lock it** — every fix ships with a regression spec that fails on the old code (K-1, K-4, K-11, K-12, P-*, I-*, R-* all have locking specs).
4. **Re-run the full gate** — fix → targeted spec → full 293-test backend suite + frontend/admin suites + builds.
5. **Honest status** — unresolved items stay visible in the BUG_REPORT with owner/action/severity, never silently dropped.

## 7. Entry / exit criteria

**Entry (met):** repository audited; real stack bootable in isolation; canonical command table established (`docs/07-TESTING_PLAN.md` §3) so nothing "fictional" is reported as executed.

**Exit (met):** all executable suites green on final run (see TEST_EXECUTION_REPORT §final-gate); confirmed defects either fixed+locked or documented with owner actions; the 9-report set written from *executed* evidence; delivery ZIP verified (exclusions + archive integrity + test-runnable-from-archive smoke).

## 8. Honest limitations of this strategy

- Playwright runs real Chromium on one engine; Safari/Firefox engine differences are NOT RUN (headless browsers for other engines are not installed in the sandbox).
- PayPal flows are as good as their network-edge mocks; live behavior stays unverified until the owner executes `docs/devops/08`.
- Coverage percentages count only instrumented Jest/Vitest runs — the real-stack Playwright E2E exercises code that those numbers do not credit.
- The load harness measures loopback throughput on shared 2-core hardware; absolute numbers are sandbox-relative, not production capacity predictions.
