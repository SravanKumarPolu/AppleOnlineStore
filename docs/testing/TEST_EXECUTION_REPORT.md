# TEST_EXECUTION_REPORT — NovaCart Full Suite Execution

**Date:** 2026-10-25 (final gate re-run twice: after the dependency fixes, then again after the owner-approved follow-up pass — react-router v7.18.4, K-6, K-7) · **Environment:** isolated sandbox — 2 vCPU, 4 GB RAM, Node v24.21.0, in-memory MongoDB 7.0.14, Playwright Chromium, loopback networking
**Every result below was produced by actually running the listed command in this environment on this date.** Nothing is simulated, extrapolated, or copied from plan documents.

---

## 1. Final gate — the complete command matrix (post follow-up pass)

| # | Command (cwd) | Result | Evidence |
|---|---|---|---|
| 1 | `backend: node --experimental-vm-modules node_modules/.bin/jest --runInBand` | **PASS** — 31/31 suites, **293/293 tests**, 0 failed, 0 skipped | ~97 s wall |
| 2 | `frontend: npx vitest run` | **PASS** — 12/12 files, **57/57 tests** | 16.9 s |
| 3 | `frontend: npm run build` (tsc -b && vite build) | **PASS** — bundle built, PWA precache 103 entries | 4.14 s |
| 4 | `frontend: npx tsc --noEmit` | **PASS** — zero diagnostics | <5 s |
| 5 | `frontend: npm run lint` | **PASS** — zero findings | <5 s |
| 6 | `frontend: npx playwright test` | **PASS** — **13/13 specs** in real Chromium vs real backend + real DB (on react-router **v7.18.4**) | 1.1 m |
| 7 | `admin: npx vitest run` | **PASS** — 13/13 files, **70/70 tests** (incl. 5 new K-6 suites) | 14.4 s |
| 8 | `admin: npm run build` | **PASS** — bundle built clean | 2.04 s |
| 9 | `admin: npm run type-check` | **PASS** — zero diagnostics (script added in the K-7 fix) | <5 s |
| 10 | `admin: npm run lint` | **PASS** — zero findings | <5 s |
| 11 | `backend: npx eslint .` | **PASS** — zero findings (incl. new `scripts/test-email.js`) | <5 s |
| 12 | `backend: node scripts/load-test.mjs --max-vu 250 --duration 15` | **PASS** — 5 levels, 0 % error, p95 ≤ 40.7 ms | ~2.5 m incl. boot |
| 13 | `backend: npm audit --omit=dev` | **PASS** — **0 vulnerabilities** | see SECURITY_TEST_REPORT |
| 14 | `frontend: npm audit --omit=dev` | **PASS** — **0 vulnerabilities** (react-router upgraded to 7.18.4) | |
| 15 | `admin: npm audit --omit=dev` | **PASS** — **0 vulnerabilities** (react-router upgraded to 7.18.4) | |
| 16 | `backend: npm run email:test` (K-7 smoke) | **PASS (designed behavior)** — graceful exit 1 with actionable message, no crash (no SMTP in sandbox) | transcript in REGRESSION_REPORT §3.3 |

**Aggregate final status: 433 automated tests green (293 backend + 57 storefront + 70 admin + 13 E2E), two production builds clean, two type-checks clean, three lints clean, load gate green, and — for the first time this engagement — all three production dependency audits at 0 vulnerabilities.**

## 2. Backend suite — per-suite results (all 31 suites PASS)

| Suite | Tests | Suite | Tests |
|---|---|---|---|
| adversarialInputValidation | 19 | orderPaymentMethods | 7 |
| authenticationAttacks | 18 | passwordResetConsumption | 7 |
| authorizationIdorAttacks | 13 | passwordResetEmail | 3 |
| businessLogicCartCheckout | 15 | paypalOrderCreate | 6 |
| concurrencyRaceConditions | 7 | paypalWebhook | 6 |
| inventoryPricingIntegrity | 10 | productCatalogReads | 12 |
| injectionWebSecurity | 16 | startupShutdown.integration | 2 |
| loggingRedaction | 17 | startupValidation | 13 |
| analyticsAggregation | 10 | userAccountLockout | 3 |
| userAuthRegistrationLogin | 8 | userAddressBook | 9 |
| cartCategoryAddressAuthorization | 13 | webhookIdempotency | 9 |
| adminAuthorization | 9 | webhookUnmatchedCapture | 8 |
| adminAuthentication | 7 | captureEndpointVerification | 4 |
| healthEndpoints | 8 | gracefulShutdown | 12 |
| productImageLifecycle | 6 | checkoutIdempotency | 4 |
| categoryManagement | 12 | (2026-10-25 coverage pass) | — |

(Per-suite counts from spec source; the authoritative total — 293 — is jest's own tally, which additionally expands `it.each` cases, e.g. orderPaymentMethods' payment-method matrix.)

## 3. Browser E2E — the 13 executed specs (real Chromium + real server + real DB)

| Spec | Duration | Verifies |
|---|---|---|
| checkout › COD checkout in a real browser creates a real order | 15.6 s | Register (form→token) → browse → product page → color + add-to-cart (server cart sync) → cart page → delivery form → COD order → `/orders` redirect → persisted order verified via API (method, `pending` status, totals) |
| checkout › Card checkout creates a real (pending) order | 9.5 s | Same money path with the Card method |
| checkout › Install App is user-initiated, never blocks login/signup | 3.7 s | PWA prompt non-blocking |
| ui-audit › every routed page renders, no console errors / failed requests | 8.2 s | Whole-storefront smoke |
| ui-audit › unknown route → NotFound (no blank screen) | 1.6 s | |
| ui-audit › product detail loads images + related products | 2.1 s | |
| ui-audit › collection search + category filter | 1.7 s | |
| ui-audit › mobile viewport (iPhone 12) — adaptive layout, bottom nav, no horizontal scroll | 1.7 s | Responsive check, real viewport |
| ui-audit › keyboard navigation reaches search + primary links | 2.0 s | a11y keyboard path |
| ui-audit › empty login submit blocked (no navigation, no token) | 2.9 s | |
| ui-audit › cart redirects anonymous users to login | 1.7 s | Protected route |
| ui-audit › session persists across full browser refresh | 5.4 s | |
| ui-audit › landmarks, image alt text, single h1 | 1.9 s | WCAG structural checks |

Expected sandbox noise (not failures): `Email service not initialized` on registration — no SMTP in the sandbox; registration/order flows assert success independently of the welcome email.

## 4. Execution timeline of this engagement (what ran, when, in what order)

| Pass | Date | Contents | Outcome |
|---|---|---|---|
| Repository audit | 2026-10-23/24 | Stack inventory, command truth table (`docs/07-TESTING_PLAN.md` §3), defect catalogue K-1…K-12 | 12 defects registered; fictional scripts identified (K-7) |
| Phase 1 security/reliability | 2026-10-23 | 8-suite regression foundation, authz closures, webhook fail-closed, redaction, health, shutdown | All green (see `docs/devops/05`) |
| K-fix wave 1 | 2026-10-24 | K-1, K-4, K-11, K-12 fixed + locking specs; admin test infrastructure built; Playwright E2E made real | Suites green |
| Test-gap closure | 2026-10-24/25 | 21 additional backend suites, admin analytics pages, Sidebar | 28-suite backend total green |
| Adversarial + invariant pass | 2026-10-25 | K-2 closed, P-1/P-2 + I-1…I-4 fixed with locking specs; R-1…R-4 concurrency suites | All green |
| Load test | 2026-10-25 (re-run this session) | 1→10→50→100→250 VU | 0 % error at every level |
| **Dependency hardening (this session)** | 2026-10-25 | nodemailer 6.10.1→10.2.1 (11 advisories cleared, backend prod audit now 0); `@cypress/react` relocated prod→dev (extract-zip HIGH left the prod tree) | Full regression re-run: **all green** (91.4 s / 271) |
| Final gate (this session) | 2026-10-25 | Everything in §1, in one pass, after the last fix | **All green** |

## 5. Fix-verification discipline (no fix without a re-run)

Each fix this engagement was verified in three steps — targeted spec → full app suite → cross-app gate. For this session's two dependency fixes:

1. **nodemailer 10.2.1** → `passwordResetEmail` + `passwordResetConsumption` (10/10 PASS) → full backend re-run **28/271 PASS** → email API surface audited first (`createTransport`/`verify`/`sendMail` only — stable across majors).
2. **@cypress/react prod→dev** → zero-import proof (`grep -rn "@cypress" src/ index.html` → 0 hits; no cypress config anywhere) → `npm audit --omit=dev` HIGH cleared → frontend 57/57 + build + tsc re-run PASS.

## 6. Commands that are known NOT to work (do not report as executed)

Per the command truth table (`docs/07-TESTING_PLAN.md` §3), still true at final gate:

- `backend: npm test` → runs `scripts/run-tests.js`, needs live MongoDB + SMTP; **not** the regression suite. NOT RUN here.
- `backend: npm run db:seed` / `db:migrate` / `email:test` → target non-existent files (K-7). NOT RUN.
- `admin: npm run type-check` → script does not exist (K-7); `npx tsc --noEmit` used instead (PASS).
- `frontend: npm run test:e2e:ui` → needs a display; headless `playwright test` used instead.
- `npx jest` in backend without `--experimental-vm-modules` → fails on ESM spec imports; canonical spelled-out command used.

## 7. Artifacts produced

- `docs/testing/load-results.json` — machine-readable load results (regenerated this session)
- `backend|frontend|admin/coverage/coverage-summary.json` — instrumented coverage
- This report set (9 documents) + the delivery ZIP (exclusions verified in REGRESSION_REPORT §5)
