# SECURITY_TEST_REPORT — NovaCart Offensive & Defensive Security Validation

**Date:** 2026-10-25 · **Method:** safe, non-destructive probes against isolated in-memory test instances — never production; no destructive DB operations; no external attack surface touched.
**Verdict up front:** all executable security suites **PASS** (78 security-focused backend tests + E2E structural checks); **all three production dependency audits now report 0 vulnerabilities** (after this session's nodemailer fix, dependency reclassification, and the owner-approved react-router v7.18.4 upgrade); remaining risk = two **owner-pending** operational items (live credential rotation K-3, live PayPal validation).

---

## 1. Security test inventory and results

| Area | Suite (tests) | Result | What is actually proven |
|---|---|---|---|
| Authentication attacks | `authenticationAttacks` (18) | **PASS** | Invalid/expired/tampered JWTs rejected; algorithm-confusion attempts fail; missing auth → 401; privilege escalation via crafted tokens fails; admin endpoints protected; brute-force lockout engages; no account enumeration on login |
| Authorization / IDOR | `authorizationIdorAttacks` (13) + `cartCategoryAddressAuthorization` (13) + `adminAuthorization` (9) | **PASS** | Shoppers can never read/mutate others' orders, addresses, or carts; spoofed body `userId` is inert (token-derived only); all 6 category mutations + order-status + debug endpoints admin-gated (401/403 matrix); status enum validated with DB-untouched proof |
| Injection & web security | `injectionWebSecurity` (16) | **PASS** | NoSQL injection (`$gt`/`$ne`/`$where` probes) neutralized; stored-XSS payloads not persisted unescaped; path traversal blocked; security headers present; CORS policy safe; upload type whitelist enforced; no sensitive-data exposure in responses |
| Adversarial input validation | `adversarialInputValidation` (19) | **PASS** | Malformed JSON, wrong types, negative/huge numbers, unicode/oversized fields on every unauthenticated + shopper-reachable vector → safe 4xx, never 500, never partial writes |
| Webhook authenticity | `paypalWebhook` (6) + `webhookIdempotency` (9) + `webhookUnmatchedCapture` (8) + `captureEndpointVerification` (4) | **PASS** | Fail-closed signature verification (invalid/missing signature → 400, no DB write); fail-close when webhook id unconfigured; replay/duplicate events ignored; recoverable idempotency state machine (never falsely acknowledges retries); amount/currency/capture-order mismatch → 409; refunded orders never clobbered |
| Secrets hygiene | `loggingRedaction` (17) + `healthEndpoints` (8) + `startupShutdown.integration` (2) | **PASS** | Mongo URI + connection strings redacted (host-only); Bearer/JWT-shaped strings scrubbed; global error handler redacts; health payloads secret-free (canary test); real-process boot log contains no secret canary |
| Startup guardrails | `startupValidation` (13) | **PASS** | `PAYPAL_ENV=live` + placeholder creds → exit 1 before any connection; `NODE_ENV=production` + weak/missing JWT_SECRET → exit 1; report names variables, never values; guardrails wired before DB connect |
| Account lockout & reset | `userAccountLockout` (3) + `passwordResetConsumption` (7) + `passwordResetEmail` (3) | **PASS** | 5 failures → 423 lock (2 h), expired lock restarts counter, success clears; reset token is single-use, hashed, 1 h TTL; weak new password changes nothing; unknown email → 200 without send (no enumeration) |
| Authn data handling | `userAuthRegistrationLogin` (8) + `adminAuthentication` (7) | **PASS** | Real bcrypt (cost 12) hashes stored; verifiable JWTs; no plaintext anywhere; inactive accounts rejected |
| Rate limiting | authLimiter exercised across suites | **PASS** (by design constraint) | 20 req / 15 min / IP on `/api/user/*` — suites budget around it; 429 observed when exceeded (documented in spec headers) |
| Browser-level structure | E2E `ui-audit` (a11y spec) + no-console-errors spec | **PASS** | No leaked errors/failed requests on any page; no token on blocked login |

**Security-focused backend total: 78 tests across 12 suites — all PASS.**

## 2. OWASP Top 10 (2021) mapping

| OWASP risk | Covered by | Status |
|---|---|---|
| A01 Broken Access Control | authorizationIdor, cartCategoryAddress, adminAuthorization suites | ✅ PASS (IDOR closure regression-locked) |
| A02 Cryptographic Failures | bcrypt cost 12 (registration spec), JWT tamper tests, TLS `rejectUnauthorized` default-on for SMTP, secret redaction suite | ✅ PASS |
| A03 Injection | injectionWebSecurity (NoSQL, XSS, path traversal, header) | ✅ PASS |
| A04 Insecure Design | webhook state machine, capture 409 gates, payment-method whitelist | ✅ PASS |
| A05 Security Misconfiguration | startupValidation fatal matrix, CORS/header probes, fail-closed webhook-id | ✅ PASS |
| A06 Vulnerable Components | `npm audit --omit=dev` × 3 (§4) + full-tree audit after the dependency diet | ✅ **0 / 0 / 0 prod trees**; full-tree advisories 141 → 22 after the K-10 cleanup |
| A07 Identif. & Authn Failures | authenticationAttacks, lockout, reset suites | ✅ PASS |
| A08 Software & Data Integrity | webhook signature fail-closed; idempotency; trusted server-side pricing (P-1) | ✅ PASS |
| A09 Logging & Monitoring Failures | loggingRedaction (redacted but complete), structured startup report | ✅ PASS |
| A10 SSRF | PayPal/SMTP egress via configured hosts only; no user-controlled URL fetch found in reachable controllers; webhook verifies via PayPal API only | ✅ PASS (probes) |

## 3. Credential & secret posture (as of final gate)

- `backend/.env` exists in the working copy with **rotated** `JWT_SECRET` (128-char) and `ADMIN_PASSWORD` (22-char) — both live-verified 2026-10-24 (old-secret token → 401; new pair → 200). It is gitignored and **excluded from the delivery ZIP**.
- `__tests__/env-setup.mjs` installs placeholder credentials only; no real credential exists anywhere in test code.
- Git-history leak (K-3): **this working copy verified clean** — the leaked `backend/.env` commit exists only in the owner's canonical repo + original distribution ZIP; history purge + provider-side rotations (PayPal/SMTP/Cloudinary/Mongo Atlas) remain **owner actions** (`docs/devops/07`, `docs/devops/09`).
- Pre-existing plaintext credentials in root `test-*.js` history files were placeholdered in a prior pass; files flagged "History — do not trust" in `AGENTS.md`.

## 4. Dependency audit — executed, with this session's fixes

| App | Before (prod tree) | Action taken (this session) | After |
|---|---|---|---|
| backend | **1 HIGH** — `nodemailer@6.10.1` (11 advisories: SMTP command injection, CRLF header injection, SSRF/file-read bypasses, DoS, domain-confusion deliveries) | API-surface audit (only `createTransport`/`verify`/`sendMail` used — stable across majors) → upgrade to **10.2.1** (clears all ranges; the widest advisory range is `>=3.0.0 <10.1.4`) → email specs 10/10 → full 271-test re-run | **0 vulnerabilities** |
| frontend | **1 HIGH + 2 moderate** — `extract-zip` HIGH via `cypress` chain **inside the production tree** (root cause: `@cypress/react` misclassified as a *production* dependency although never imported by shipped code — zero `@cypress` imports in `src/`, no cypress config) | Minimal fix: relocated `@cypress/react` → devDependencies; lockfile regenerated | **0 vulnerabilities** (after the react-router upgrade below) |
| admin | 2 moderate — `react-router`/`react-router-dom` 6.28.1 | **Upgraded to react-router-dom 7.18.4** (owner-approved follow-up — see §5 S-3) | **0 vulnerabilities** |

**Final state (2026-10-25, post fix-remaining pass): `npm audit --omit=dev` = 0 / 0 / 0 across backend, frontend and admin. Full-tree (incl. dev) advisories: 141 → 22 (dependency diet, K-10) → 14 (safe `npm audit fix`) → **3 moderate** (forced toolchain majors executed with full-gate validation: vitest 1/3 → 5.0.5 in both apps; admin now **0/0 total**, backend was already 0/0 total). The dependency diet removed 52 dead declarations — 45 in frontend (34 prod incl. `@stripe/*`, `@react-oauth/google`, three state managers, two date libs, two chart libs; 11 dev incl. the entire dead cypress family), `axios` in backend + frontend, 5 dead backend devDeps (patch-package, testcontainers, husky, lint-staged, cross-env), `@tailwindcss/postcss` in admin — every removal preceded by a usage-classification audit + independent direct-import greps (zero references) and followed by the full test gate. Residual 3 = one build-time chain (postcss-selector-parser via postcss-nested via tailwindcss, pinned at 3.4.17 — the only fix is the tailwind 4 migration, an owner-scope framework migration with visual-regression risk; see AR-2). Validation of the forced majors: FE 57/57 + build + tsc + lint, admin 70/70 + build + type-check, E2E 13/13, lockfile rollback staged at every step; the two vitest-5 adjustments were test-only (stale `toEqual` pre-dating the AF-1 header contract; `Mock<>` generic form).**

## 5. Fix details (minimal-safe, evidence-backed)

**S-1 (this session) — nodemailer HIGH chain.** Severity: high (prod dependency, externally influenced email path). Root cause: 6.x line end-of-life relative to 2025-2026 advisory wave. Fix: `npm install nodemailer@10.2.1`. Verification: email contract specs (`passwordResetEmail` 3/3, `passwordResetConsumption` 7/7) → full backend gate 28 suites / 271 tests PASS. No code changes required (API-compatible usage).

**S-2 (this session) — `@cypress/react` in the production dependency tree.** Severity: high *by audit classification* (extract-zip symlink traversal) but **not exploitable at runtime** (module never imported/bundled — verified `grep -rn "@cypress" src/ index.html` → 0 hits; Vite tree-shakes nothing that is never imported, and nothing imports it). Fix: dependency reclassification only — zero source change. Verification: frontend 57/57 + build + tsc PASS; `npm audit --omit=dev` HIGH cleared.

**S-3 (follow-up pass, owner-approved) — react-router-dom 6.28.1 → 7.18.4 in BOTH apps.** Severity: moderate (2 advisories × 2 apps). Pre-upgrade safety audit: both apps use only declarative-mode APIs (`BrowserRouter`/`Routes`/`Route`/`Link`/`NavLink`/`useNavigate`/`useLocation`/`useSearchParams`/`useParams`) — no data routers, no loaders/actions/fetchers, all route paths absolute (the v7 `relativeSplatPath` behavior change is inert); React 18/19 both satisfy v7's floor. Fix: `npm install react-router-dom@7.18.4` in frontend + admin — **zero source changes required**. Verification: frontend 57/57 + build + tsc + lint, admin 70/70 + build + type-check, **13/13 real-browser Playwright E2E** (proving navigation, protected-route redirects, session persistence and 404 behavior under v7's default semantics), and `npm audit --omit=dev` → **0 vulnerabilities in both apps**.

## 6. Accepted risks (documented, not hidden)

**AR-1 (RESOLVED 2026-10-25): `react-router-dom` 6.28.1 — 2 moderate advisories (frontend + admin).**
Originally documented as an accepted risk (remediation required the breaking v7 major, out of minimal-fix scope for the testing engagement). Executed as an owner-approved follow-up the same day: pre-upgrade API-surface audit confirmed upgrade safety → both apps upgraded to **7.18.4** with zero source changes → full regression + 13/13 real-browser E2E → all audits 0/0/0. (Historical applicability analysis: the SSR-hydration advisory was never applicable — pure SPAs; the open-redirect advisory is moot on the patched version.)

**AR-2 (REDUCED 2026-10-25, second stage): dev-only toolchain advisories.** Originally 141 full-tree advisories across the three apps. Stages: (1) the K-10 dependency diet removed the cypress family and 49 other dead declarations → 22; (2) a safe `npm audit fix` → 14 (backend tree fully clean, 0/0 total); (3) **toolchain majors executed with full-gate validation** — `npm audit fix --force` in frontend + admin: vitest 1.0.4→5.0.5 / 3.2.7→5.0.5 (plus @vitest/coverage-v8, tinypool, esbuild, @vitest/mocker chains) — admin is now **0/0 total**; frontend cleared the high+critical advisories, with tailwindcss deliberately **pinned back at 3.4.17** (exact, devDep) because --force had swept it to 4.3.3, whose PostCSS-plugin/config-format migration is a real framework migration with visual-regression risk — out of scope for a hardening pass, owner decision. Residual: **3 moderate advisories, all one build-time chain** (postcss-selector-parser quadratic-parse GHSA-rj75-hqrm-r3gf via postcss-nested via tailwindcss@3 — even the latest 3.4.19 carries it; the only fix is the tailwind 4 migration above). Never shipped to production (build-time only, no untrusted input reaches it); accepted with periodic `npm audit` review. Prod trees: 0/0/0 throughout. Validation for stage 3: the two vitest-5 test-only adjustments (PlaceOrder AF-1 header assertion; Login `Mock<>` generic form) + FE 57/57 + build (PWA 103 entries) + tsc + lint, admin 70/70 + build + type-check, E2E 13/13 — all green before acceptance; lockfile rollback was prepared at every step.

## 7. Owner-pending security items (cannot be closed from this environment)

| Item | Why blocked | Runbook |
|---|---|---|
| Provider credential rotation (PayPal, SMTP, Cloudinary, Mongo Atlas) + canonical-repo history purge | Requires provider dashboards + repo ownership | `docs/devops/07` |
| Live PayPal webhook signature validation end-to-end | Needs real sandbox creds + public HTTPS host | `docs/devops/08` |
| Real SMTP relay hardening (SPF/DKIM/DMARC) | No SMTP in sandbox | post-rotation task |

## 8. Residual-risk statement

Code-level attack surface reachable without authentication or with a shopper token is covered by passing adversarial suites. The PayPal network edge is trusted-but-mocked (stubbed HTTP client); until the owner executes the sandbox checklist, webhook/capture behavior against *real* PayPal infrastructure remains formally unverified — this is the single largest residual security unknown and is reflected as an owner-pending gate in PRODUCTION_READINESS.
