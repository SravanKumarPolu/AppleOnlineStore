# Security Regression Report — Pre-DevOps Stabilization

**Date:** 2026-10-26. This report covers the security findings of the audit, the fixes applied in this phase, and the regression tests that pin them. No secret values are printed anywhere in this document.

---

## 1. Findings and dispositions

### SEC-01 — MongoDB connection string construction bug (Phase 2) — **FIXED**
- **Where:** `backend/config/mongodb.js` (and duplicated in `scripts/checkDatabase.js`, `seedCategories.js`, `migrateOrders.js`, `testCategories.js`).
- **Problem:** `` `${process.env.MONGODB_URI}/e-commerce` `` was appended unconditionally. A complete URI (with database and/or query string) was corrupted (`/e-commerce/e-commerce?...`), and an unset variable produced the literal `undefined/e-commerce` with a confusing driver failure. `checkDatabase.js` additionally logged the **raw URI including credentials**.
- **Fix:** pure `resolveMongoConnectionUri(env)` — complete URIs respected verbatim; bare host URIs get `MONGODB_DB` (default `e-commerce`); missing/wrong-scheme/unparseable values throw credential-safe errors **before** connecting; `connectDB` verifies readyState + `ping` before reporting ready; all log lines use the redacted host-only summary. All five scripts now share the resolver; none logs the raw URI.
- **Regression:** `__tests__/mongodbConnectionConfig.spec.js` (19 tests: valid complete/bare/override/whitespace matrix, 8 malformed/missing cases, credential-leak assertion, 4 integration cases on in-memory MongoDB).
- **Residual risk:** none identified. Existing deployments using bare host URIs keep the same database.

### SEC-02 — Admin tokens accepted by shopper middleware (Phase 3) — **FIXED**
- **Where:** `backend/middleware/auth.js` (`authUser`).
- **Problem:** `authUser` passed `type: 'admin'` tokens with `req.user.id = null`. Individual controllers rejected the null id (401/403), but the boundary was inconsistent, and the analytics admin routes **required** the hole (they chained `protect, admin`, i.e. admin tokens had to survive shopper middleware). Any future controller forgetting the null check would have exposed shopper routes to admin tokens (which carry no user binding and no tokenVersion).
- **Fix:** `authUser` now rejects admin tokens centrally with 403 ("Admin tokens cannot access shopper endpoints"). The redundant `protect` layer was removed from the six admin analytics routes (`authAdmin` alone enforces identical authorization). No legitimate flow regressed: the admin console calls only admin/public endpoints (verified by endpoint inventory), and the storefront uses shopper tokens only.
- **Regression:** `__tests__/shopperAdminTokenBoundary.spec.js` (24 tests: admin-token rejection across every shopper route in both header formats, shopper-token continuity, admin-endpoint continuity, cross-user IDOR guards, tampered/forged/escalated/garbage/malformed-header cases). Updated expectations in `analyticsAggregation.spec.js` and `authorizationIdorAttacks.spec.js` (admin tokens on shopper routes: 400/401 → 403, rejected earlier and uniformly).

### SEC-03 — Hardcoded historical CORS origins (Phase 4) — **FIXED**
- **Where:** `backend/app.js` (Express) and `backend/services/socketService.js` (Socket.IO — which had a **different**, drifted list).
- **Problem:** production Netlify origins (`skr-e-commerce.netlify.app`, `admin-skr-e-commerce.netlify.app`) were baked into source; nothing in the current apps references them (only stale og:url metadata in `frontend/index.html`). Socket.IO additionally allowed unused dev ports 5175–5177 while the two policies could drift silently.
- **Fix:** single source of truth `config/allowedOrigins.js` used by both policies: fixed dev origins (localhost:3000/5173/5174) + env-driven `FRONTEND_URL`/`ADMIN_URL`/`CORS_EXTRA_ORIGINS`, slash-normalized and deduplicated. No wildcard-with-credentials is possible (exact-match callback).
- **Regression:** `__tests__/corsOriginConfiguration.spec.js` (9 tests: dev origins always present, env origins included/normalized, extra origins parsed, dedup, no hardcoded Netlify domains, env can re-add them explicitly, live CORS headers with credentials, unlisted origin rejected, never `*`).

### SEC-04 — Debug endpoints active in production (Phase 4) — **FIXED**
- **Where:** `/api/user/debug`, `/api/orders/debug`.
- **Problem:** admin-only (previously fixed) but still active in production, dumping user PII (names, emails, addresses, order history) and order data. No frontend/admin code calls them (verified by search).
- **Fix:** `middleware/debugGuard.js` runs **before** `authAdmin` on both routes: `NODE_ENV=production` → 404 for everyone (existence hidden, including from unauthenticated probes) unless `ENABLE_DEBUG_ENDPOINTS=true`; non-production unchanged.
- **Regression:** `__tests__/debugEndpointProductionGuard.spec.js` (7 tests: 401/403/200 in non-prod; 404-for-all in production; explicit re-enable honors admin-only; non-`true` values keep disabled).

### SEC-05 — Committed credentials in legacy root scripts (Phase 4) — **FIXED (redaction) + ROTATION RECOMMENDED**
- **Where:** `test-paypal-transfer.js` (historical admin email + password), `debug-admin-auth.js`, `test-paypal-analytics.js`, `test-paypal-business-integration.js`, `test-paypal-integration.js`, `verify-paypal-capture.js` (PayPal **sandbox** test-account password printed in help text), `check-admin-users.js` (hardcoded weak seeding password `admin123`).
- **Fix:** all values redacted — the transfer script now reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the environment (exits with guidance when unset); sandbox-account help text points to PayPal developer settings; the seeding script generates a random per-run password.
- **Rotation recommendation (manual, per task restrictions):** if the historical admin password was ever used on a deployed environment, rotate it now (it lived in repository history). The sandbox-account password should be rotated as routine hygiene, though sandbox-only exposure is low severity. **No real `.env` files were found in the repository** — the audit sweep (AWS keys, Stripe keys, GitHub tokens, private keys, JWT literals) found no other committed secrets; the single grep hit in `startupValidation.spec.js` is a synthetic test fixture designed to be a non-placeholder credential, verified not to be a real secret.

### SEC-06 — Misleading test entry point (scripts/documentation integrity) — **FIXED**
- `backend/package.json` `test` ran a manual smoke script requiring live DB/SMTP, while documentation claimed "293 tests". `test` now runs the Jest suite (355 tests); the smoke runner is `test:smoke`. Prevents a future operator from believing the smoke runner's 7 categories are the regression suite.

### Verified-and-secure (no action needed)

- **Webhook signature verification** — fail-closed via PayPal's verify-webhook-signature API; missing webhook id/headers/malformed events rejected before any DB write (`paypalWebhook.spec.js`).
- **Capture amount/currency verification** — capture and webhook paths both verify cents-accurate amounts against the order; mismatches never mark orders paid and raise alerts (`captureEndpointVerification.spec.js`).
- **IDOR closures** — cart/order/address flows derive user identity only from the token; body-supplied userIds are ignored (`authorizationIdorAttacks.spec.js`, `cartCategoryAddressAuthorization.spec.js`).
- **Injection hardening** — mongo-sanitize + regex-escaped search + validator schemas (`injectionWebSecurity.spec.js`, `adversarialInputValidation.spec.js`).
- **Credential redaction** — logs and non-production errors mask Mongo URIs, Bearer/Basic headers, JWT-shaped strings (`loggingRedaction.spec.js`).
- **Account lockout & password policy** — 5-attempt lock for 2 h; bcrypt(12); policy at three layers (`userAccountLockout.spec.js`).
- **Session invalidation on reset** — tokenVersion bump invalidates all prior tokens (`passwordResetConsumption.spec.js`).
- **Rate limiting** — global + auth-specific with health exemption.
- **Startup guardrails** — live PayPal with placeholder credentials, or production without JWT_SECRET, refuse to boot (`startupValidation.spec.js`).

---

## 2. Threat-model notes for the DevOps phase

1. **Admin identity is environment-based** (`ADMIN_EMAIL`/`ADMIN_PASSWORD` compared directly). Recommend migration to a DB-backed admin with MFA in a future phase; until then the password comparison could be hardened to constant-time and the credential rotated from any historical value.
2. **JWTs are stateless with 7-day shopper expiry**; revocation exists only via `tokenVersion` (bumped on password reset). A blocklist/short-lived-token design is a future hardening option.
3. **Socket.IO authenticates but does not re-validate tokenVersion on long-lived connections** — an admin-locked-out or password-reset user keeps an existing socket until disconnect. Low severity; note for future work.
4. **PayPal `payee.email_address` is pinned to a sandbox business account** in order creation — must be made configurable before `PAYPAL_ENV=live` (fatal-boot guardrails already prevent half-configured live deployments, but the payee pin itself would misroute live payments).
5. **No TLS in the current topology** — the API expects termination upstream; ensure the DevOps phase provides it before go-live.

---

## 3. Security regression inventory (all green on final run)

35 backend suites / 355 tests, of which the security-relevant sets are: `adminAuthentication`, `adminAuthorization`, `adversarialInputValidation`, `authenticationAttacks`, `authorizationIdorAttacks`, `cartCategoryAddressAuthorization`, `concurrencyRaceConditions`, `corsOriginConfiguration` ★, `debugEndpointProductionGuard` ★, `injectionWebSecurity`, `loggingRedaction`, `mongodbConnectionConfig` ★, `passwordResetConsumption`, `shopperAdminTokenBoundary` ★, `startupValidation`, `userAccountLockout`, `webhookIdempotency`, `webhookUnmatchedCapture`, plus the payment-integrity suites listed in `FINAL_TEST_EXECUTION.md`. ★ = added this phase.
