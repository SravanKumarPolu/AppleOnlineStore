# Phase 1 Security Baseline — NovaCart

> Validated by execution on 2026-10-23 (incl. the Final Security & Reliability
> Gate). Security regression suite: `npm run test:security` in `backend/` —
> **8 suites / 76 tests, all passing** (exit 0).

## 1. Authentication

| Mechanism | Detail | Status |
|---|---|---|
| User login | `POST /api/user/login`, bcrypt (12 rounds default), JWT HS256, 7-day expiry | Working (verified by backend suite security category + frontend 26 tests) |
| Admin login | `POST /api/user/admin`, env credentials (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), JWT 1-day, `type:'admin'` | Working; plaintext env compare is a known limitation (see §6) |
| Password reset | Token-based reset via email; token hashed with expiry | Working (email suite category) |
| Token transport | `token` header or `Authorization: Bearer`; sockets: handshake auth token verified with same secret | Working |

Known limitation (unchanged in Phase 1, tracked): admin identity is env-based
with a non-timing-safe `===` compare and no DB-backed bcrypt admin user.
Remediation proposal S3 in `../SECURITY_GATE_PLAN.md`.

## 2. Authorization (Phase 1 changes — all verified by tests)

| Route | Guard (before) | Guard (now) | Test evidence |
|---|---|---|---|
| `PUT /api/orders/status` | `authUser` (any logged-in user could set ANY status string) | `authAdmin` + server-side status whitelist (orderModel enum) | 401/403/400/200 matrix in `adminAuthorization.spec.js` |
| `GET /api/orders/debug` | **none** (PII dump of recent orders) | `authAdmin` | 401/403/200 in `adminAuthorization.spec.js` |
| `GET /api/user/debug` | `authUser` (any logged-in user dumped all users) | `authAdmin` | 403/200 in `adminAuthorization.spec.js` |
| `POST /api/orders/paypal/webhook` | none + **no signature verification** (code comment admitted it) | PayPal `verify-webhook-signature` API, fail-closed + recoverable-idempotency state machine | 6 cases in `paypalWebhook.spec.js` + 9 in `webhookIdempotency.spec.js` |
| `POST /api/cart/{add,get,update,sync-local}` | **none** — controllers trusted body `userId` (any anonymous caller could read/modify ANY user's cart — Critical IDOR) | `authUser` on all four routes; `userId` derived from the verified token, body `userId` ignored; admin tokens 403 | 7 cases in `cartCategoryAddressAuthorization.spec.js` (cross-user read/write/update attempts land on the caller's own cart; victim data proven untouched) |
| `/api/category/{add,update,delete}` + 3 subcategory routes | **none** (comments claimed admin-only, no middleware) | `authAdmin` on all 6 mutation routes; `GET /list` stays public for the storefront | 4 cases in `cartCategoryAddressAuthorization.spec.js` incl. real admin DB write |
| `POST /api/address/save` | **none** (anonymous writes into the shared address collection; route has no callers — dead endpoint) | `authUser` | 2 cases in `cartCategoryAddressAuthorization.spec.js` |
| Product add/remove, analytics routes, all-orders | `authAdmin` / `protect, admin` (already correct) | unchanged | existing behavior preserved |

Authorization-bypass audit: orderStatus/paymentStatus writes were greped
across all controllers/services — the only mutation paths are the guarded
`updateStatus` (admin) and verified webhook/capture flows. No alternate
unauthenticated mutation route exists for order state. Cart/category/address
authorization (former optional items O1–O3) was implemented and closed in
the final gate after the follow-up audit confirmed the vulnerabilities.

## 3. PayPal webhook verification (new in Phase 1)

- Service: `backend/services/paypalWebhookService.js`.
- Mechanism: PayPal's supported verification — `POST /v1/notifications/verify-webhook-signature`
  through the existing `PayPalHttpClient` (same client id/secret/environment
  as order capture; sandbox unless `PAYPAL_ENV=live`).
- Inputs: the five required transmission headers
  (`Paypal-Transmission-Id/Time/Sig`, `Paypal-Cert-Url`, `Paypal-Auth-Algo`),
  the webhook id (`PAYPAL_WEBHOOK_ID` env), and the event parsed from the
  **raw request body** (captured by `express.json` `verify` for exactly that
  route — PayPal signs the bytes it sent).
- Fail-closed semantics (all covered by tests):
  - missing `PAYPAL_WEBHOOK_ID` → rejected, never processed
  - missing/malformed headers → rejected before any PayPal call
  - `verification_status !== 'SUCCESS'` → rejected, no DB write
  - network/verification request failure → rejected
  - malformed event body → 400
- Duplicate/replay protection (upgraded in the final gate to **recoverable
  idempotency**): `webhookevents` collection with a unique `eventId` index
  and a status machine — `processing` → `completed` (with
  `completedAt`/`result`) or `failed` (with redacted, length-bounded
  `lastError`). A retry delivery is acknowledged as a duplicate ONLY when
  the record reached `completed`; `failed` / stale `processing` (beyond
  `WEBHOOK_PROCESSING_LOCK_MS`, default 30 s) / legacy no-status records are
  re-acquired and re-processed (the order update is idempotent, making this
  safe). A fresh `processing` lock returns 500 so PayPal retries later.
  Verified by `webhookIdempotency.spec.js`, including the exact regression
  the final gate closed: a delivery whose order update throws is marked
  `failed` and 500'd, and the retry delivery RE-PROCESSES it to completion
  (the pre-final-gate implementation acknowledged that retry as a duplicate
  and the payment event was lost).
- Valid events keep the exact previous processing behavior
  (`PAYMENT.CAPTURE.COMPLETED` → `paymentStatus: 'completed'`).

## 4. Secrets management

- `.gitignore` (root + per package) excludes `.env` with `!.env.example`;
  `git ls-files` confirms only `*.env.example` are tracked. `.env.example`
  files contain placeholders only (verified line-by-line).
- **MongoDB URI logging removed** — `config/mongodb.js` now logs a
  host-only summary (`mongodb://***:***@host/db`); error paths are redacted
  by `utils/redact.js`. Regression test injects a canary password against an
  unreachable server and asserts the canary never appears in captured
  console output.
- PII trimmed from operational logs: PayPal capture no longer logs the full
  response JSON outside non-production (payer data); userOrders no longer
  logs request bodies; all `console.error(error)` sites in
  orderController/cartController route through `redactError`.
- **Final gate — response-side hardening**: the global error handler is
  exported and logs a redacted stack via `redactText` (mongo URIs,
  Bearer/Basic credentials, JWT-shaped tokens); non-production 500 messages
  are redacted (production stays generic `Internal Server Error`);
  `capturePayPalPayment` no longer returns raw `error.message` or the full
  PayPal capture `details` payload to clients in production (stable code
  `PAYPAL_CAPTURE_ERROR` instead — the intentional
  `CURRENCY_NOT_SUPPORTED`/`PAYPAL_UNAVAILABLE` codes are unchanged).
  Mongoose ValidationError/CastError/11000 semantics preserved (tested).
- Health endpoints emit only booleans/status strings (tested for absence of
  connection strings and secret names).
- Startup/shutdown integration test asserts a secret-bearing env value
  (canary `ADMIN_PASSWORD`) never appears in process stdout/stderr.

### 4.1 Exposure requiring rotation (owner action — cannot be fixed by tooling)

Git-history secret audit (final gate; values never printed, only key names
and object/commit locations):

- **Full live credential set — `backend/.env` blob byte-identical to the
  current real `.env`** (MONGODB_URI incl. password, JWT_SECRET,
  ADMIN_EMAIL, ADMIN_PASSWORD, CLOUDINARY_API_KEY/SECRET_KEY,
  PAYPAL_CLIENT_ID/SECRET) is reachable through the agent-session refs
  `refs/agents/b94c8ad9-…/checkpoints/turn/{0,1}` (commits `9d36bce`,
  `7855434`). A historical `backend/server.log` blob embeds the same
  Mongo password. These refs live in `.git` — excluded from the delivered
  ZIP, but present in the repository copy.
- **`main@00b08de` (pushed to `origin`, a public GitHub URL) contains a
  suspect-real ADMIN_PASSWORD-shaped value (length 21, non-placeholder) in
  two setup docs and several `PAYPAL_CLIENT_ID` occurrences.** The client id
  is public by design; the admin password value must be treated as exposed.
- Working tree after final-gate sanitization: no real credential values in
  tracked text files (verified by pattern scan; `.env` itself remains
  untracked and is excluded from the delivered archive).
- **Required owner actions**: rotate MongoDB credentials, `JWT_SECRET`,
  `ADMIN_PASSWORD`, `CLOUDINARY_API_KEY`/`SECRET_KEY`, and the PayPal
  client secret; then purge history
  (`git for-each-ref --format='%(refname)' refs/agents | xargs -n1 git update-ref -d`
  plus `git reflog expire --expire=now --all && git gc --prune=now --aggressive`,
  verify with `git fsck`). **No history rewrite was performed in this
  milestone — it requires explicit owner approval.** Full procedure:
  `../SECURITY_GATE_PLAN.md` §S1.
- The delivered ZIP excludes real `.env` files AND the entire `.git`
  directory (both agent-checkpoint refs and the pushed main history).
- **Pre-existing documentation leaks found by the archive credential scan and
  sanitized in the earlier milestone**: `verify-paypal-capture.js` (hardcoded PayPal
  sandbox client secret — now reads `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`
  from env), `PAYPAL_SANDBOX_FIX.md` (documented client secret — replaced
  with a placeholder), `PAYPAL_TRANSFER_IMPLEMENTATION.md` (documented admin
  password — replaced with a placeholder). The public PayPal client ID
  intentionally remains in frontend/docs (it is designed to ship in browser
  bundles); the paired secret does not.

## 5. Platform hardening already in place (verified)

helmet 8 + CSP; CORS allow-list; global rate limit (1000/15 min) + auth rate
limit (20/15 min); `express-mongo-sanitize`; `express-validator` on user and
product routes; multer MIME allow-list + size limits; JWT secret length 128;
`jwt.verify` with the shared secret (algorithm pinning is a tracked backlog
item S7).

## 6. Risk register (status after the final gate)

| ID | Risk | Status |
|---|---|---|
| S1 | Live credentials in git history (agent-checkpoint refs hold the full live `.env` blob; pushed `main` holds a suspect-real admin password) | ⚠️ Rotation + approved history purge required from owner |
| S2 | npm audit advisories (backend 64, frontend 55, admin 22 totals incl. dev-tree) | ⏳ Remediation plan drafted, pending approval |
| S3 | Env-based admin login (plaintext compare) | ⏳ Plan drafted |
| S4 | No JWT revocation / 7-day tokens | ⏳ Plan drafted |
| S5 | Dead `middleware/adminAuth.js` (would reject all admin tokens if wired) | ⏳ Hygiene backlog |
| S6 | Duplicated auth middlewares | ⏳ Hygiene backlog (auth.js now exports named + default for import-style consistency) |
| O1–O3 | Cart IDOR / category+address unauthenticated writes | ✅ **CLOSED in the final gate** (route guards + token-derived ownership + 13 regression tests) |
| — | Node runtime vs engines field | ✅ Closed: `engines.node` `>=22` (runtime is v24 LTS; Node 18 is EOL). No code changes required — full regression passed on v24 |
| — | Webhook interrupted-processing acknowledged as duplicate | ✅ **CLOSED in the final gate** (recoverable idempotency state machine + 9 regression tests) |
| — | JWT in localStorage (XSS exfiltration tradeoff) | Documented decision |
