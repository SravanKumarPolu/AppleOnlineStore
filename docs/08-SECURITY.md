# NovaCart — Security Documentation (As-Built)

> **Status:** Current as of 2026-10-27. The authoritative Phase 1 security
> record with full evidence is
> [docs/devops/02-SECURITY-BASELINE.md](./devops/02-SECURITY-BASELINE.md) —
> this file summarizes it, updates statuses, and adds the whole-repository
> view (frontends, env templates, dependency hygiene).
>
> **Chain:** … → [05-API_REFERENCE.md](./05-API_REFERENCE.md) →
> [06-DEPLOYMENT.md](./06-DEPLOYMENT.md) → [07-TESTING_PLAN.md](./07-TESTING_PLAN.md)
> → **this file** → [09-OPERATIONS.md](./09-OPERATIONS.md)

## 1. Authentication & authorization model (summary)

- **Shoppers:** bcrypt(12) + JWT HS256 (7 d, `{id}`), DB-checked and
  `isActive`-checked on every guarded request. Account lockout: 5 failed
  logins → 2 h lock (HTTP 423).
- **Admin:** env-credential login (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) → 1-day
  JWT `{email, role:'admin', type:'admin'}`. Admin email comparison trims
  surrounding whitespace and ignores case; password comparison remains exact.
  Rotating `ADMIN_PASSWORD` alone does not revoke issued admin JWTs; rotate
  `JWT_SECRET` to invalidate them. A DB user with
  `role:'admin'` (accepted by both middleware stacks).
- **Token transport:** custom `token` header (storefront) or
  `Authorization: Bearer` (admin analytics pages) — both accepted by both
  middleware stacks. Socket.IO handshake carries the same JWT.
- **Two live middleware stacks** with identical semantics
  (`middleware/auth.js` for most routers; `middleware/authMiddleware.js` for
  analytics) and **one dead** (`middleware/adminAuth.js` — never wired).
  Consolidation is backlog item S5/S6.
- JWTs live in `localStorage` on both frontends (XSS-exfiltration tradeoff —
  documented decision); there is **no revocation mechanism** (S4).

## 2. Platform hardening in place (verified by tests)

helmet 8 + CSP (script-src 'self'; styles allow inline; images allow
https/data) · CORS allowlist (see [05-API_REFERENCE.md](./05-API_REFERENCE.md)
§1) · global rate limit 1000/15 min/IP + auth limiter 20/15 min/IP ·
`express-mongo-sanitize` · `express-validator` on user/product routes ·
multer MIME allowlist + size limits · 10 MB body cap · mongo operators
stripped · secrets never logged (redaction layer, canary-tested) ·
production 500s generic · health payloads booleans-only.

## 3. Vulnerabilities fixed in Phase 1 (evidence: `docs/devops/02` §2)

| Class | Fix (all regression-tested) |
|---|---|
| Order-status IDOR (any user could set any status string) | `authAdmin` + server-side enum whitelist |
| **Cart IDOR (Critical)** — 4 unauthenticated routes trusting body `userId` | `authUser` + token-derived ownership; spoofed ids proven inert |
| Category mutations + address save unauthenticated | `authAdmin` / `authUser` guards |
| PII debug dumps (`/api/orders/debug`, `/api/user/debug`) | admin-only |
| Webhook forgery (no signature verification) | fail-closed `verify-webhook-signature` + raw-body capture |
| Webhook replay / lost events | unique-index event store + recoverable idempotency state machine (+ unresolved-retry budget, reconciliation, amount/currency/identity gates — later hardening) |
| Credential leakage in logs/responses | redaction layer, host-only URI summaries, stable error codes in production |

## 4. Risk register (status updated 2026-10-24)

| ID | Risk | Status |
|---|---|---|
| **S1** | **Live credentials in git history** — full `backend/.env` blob in agent-checkpoint refs (`9d36bce`, `7855434`), a Mongo password in a historical `server.log`, and a suspect-real admin password on pushed `main@00b08de` (leak confined to the **owner's canonical repo** — this working copy verified clean: [docs/devops/09-GO-LIVE-GATES-EXECUTION.md](./devops/09-GO-LIVE-GATES-EXECUTION.md) §1.4). **Also exposed through a distributed ZIP archive containing the ignored `backend/.env`** (found 2026-10-26; now gated by `npm run security:distribution`). **Correction (2026-10-26, whole-repo scan):** this checkout ALSO carries agent checkpoint refs (`refs/agents/a3b39132…/checkpoints/turn/0–3`) — but their snapshots were verified to hold only **synthetic** values (the startup verifier's `verify-*` boot string; an expired fabricated mock JWT, waived by the expiry-aware rule). The earlier "verified clean" was true only for a backend-scoped scan (see S8); no live credential has been found in this checkout's refs | 🟡 **Partially closed (2026-10-24):** `JWT_SECRET` + `ADMIN_PASSWORD` rotated locally and live-verified (pre-rotation tokens 401, new admin pair 200). Remaining owner actions: PayPal secret/webhook id, MongoDB Atlas password, Cloudinary/SMTP keys (dashboard rotations) + canonical-repo history purge. Runbook: [docs/devops/07](./devops/07-CREDENTIAL-ROTATION-RUNBOOK.md); execution record: [docs/devops/09](./devops/09-GO-LIVE-GATES-EXECUTION.md) |
| **S8** | **Security gates were cwd-scoped to `backend/`** — `git ls-files` / `git log` / `git archive` run from `backend/` see only `backend/**` (106 of 482 tracked files), so the secret scanner, history scan and distribution gate silently ignored `frontend/`, `admin/`, `docs/` and root scripts; an archive built that way also shipped backend-only content. Caught on 2026-10-26 when a real PayPal secret was pasted into `frontend/.env.example` and the gate stayed green | ✅ **Closed 2026-10-26** — both scripts anchor at the repo toplevel; whole-repo tree + history scan clean; regression specs lock a secret in `frontend/` being caught from a `backend/` cwd and an archive containing the full tree |
| S2 | npm audit advisories | ✅ **Re-baselined 2026-10-26** (non-mutating `npm audit`): backend **0**, admin **0**, frontend **3 moderate** — all in the build-time Tailwind 3 / PostCSS chain (`postcss-selector-parser` CPU-exhaustion), no high/critical. Remediation is the planned Tailwind 4 upgrade window; not a runtime exposure |
| S3 | Env-based admin login, non-timing-safe plaintext compare | 📋 Plan drafted |
| S4 | No JWT revocation; 7-day user tokens | 📋 Plan drafted |
| S5 | Dead `middleware/adminAuth.js` | ✅ **Closed** — file deleted 2026-10-25 (K-9 consolidation) |
| S6 | Duplicated auth middleware stacks | ✅ **Closed** — single `middleware/auth.js` (`authUser`/`authAdmin`); `authMiddleware.js` deleted |
| S7 | JWT algorithm not pinned in `jwt.verify` | ✅ **Closed 2026-10-26** — both `authUser` and `authAdmin` verify with `{ algorithms: ['HS256'] }`; the existing `alg:none` rejection case in `authenticationAttacks.spec.js` plus the auth suites (60 tests) stay green |
| — | Refund duplication / false finalization (`PENDING` recorded as refunded) | ✅ **Closed 2026-10-26** — atomic intent claim before the gateway call, separate `refundStatus`, 202 for PENDING, signed `PAYMENT.CAPTURE.REFUNDED` reconciliation, amount+currency verification (K-14) |
| — | Permanent inventory loss when a restoration credit failed | ✅ **Closed 2026-10-26** — durable per-item marker + `inventoryRestoration` retry sweep + alert (K-13) |
| — | **Creation-time reservation was not crash-safe** (decrement before the order existed) | ✅ **Closed 2026-10-26** — order draft first + per-line debit marker in the same atomic product update + `stockReservation` commit + abandonment sweep (K-21, §16.4.1 plan) |
| — | **A rotated credential stayed live in a running process** | ✅ **Closed operationally 2026-10-26** — the dev server started before the rotation still accepted the old admin password (200) and rejected the new one; restarted from the rotated env, then old → 401 / new → 200. Rotation runbooks must include the restart (trap 25 covers token validity) |
| — | **Dangling git objects cannot be seen by the ref-walking scanners** | 🟡 **Gated, purge pending** — `npm run security:dangling` compares unreachable blobs with the current `.env` and exits 1 while a live value is there; as of 2026-10-26 MongoDB + Cloudinary are still live in blob `e8f6c66d` (owner rotations). See S1 |
| — | Late capture resurrecting a cancelled order | ✅ **Closed 2026-10-26** — pre-flight refusal + atomic cancelled/refunded guard, capture recorded for refund, alert (K-15) |
| — | Socket.IO order-room IDOR + populated `userId` room-key bug | ✅ **Closed 2026-10-26** — ownership check on join, typing allow-list, room key from `userId._id` (K-16) |
| — | Secret scanner fixture exclusions could hide a real credential | ✅ **Closed 2026-10-26** — fixtures are scanned; only clearly synthetic values are waived; locked by `secretScanner.spec.js` |
| O1–O3 | Cart IDOR / category+address unauthenticated writes | ✅ **Closed** (final gate, 13 regression tests) |
| — | Webhook interrupted-processing acknowledged as duplicate | ✅ **Closed** (state machine + later unmatched-capture hardening) |
| — | PayPal env split-brain (capture keyed off `NODE_ENV`, verifier off `PAYPAL_ENV`) | ✅ **Closed** — single `PAYPAL_ENV` switch + boot guardrails |
| — | Placeholder/live credential misconfiguration on deploy | ✅ **Closed** — startup validation exits 1 on fatal combos |

## 5. Secrets management rules (this repository)

1. Never commit `.env` (all `.gitignore`s exclude it; only `*.env.example`
   are tracked, placeholders only — verified line-by-line).
2. Examples must document variable **names** only; a documented secret is a
   leaked secret (three such historical leaks were found and placeholdered —
   `verify-paypal-capture.js`, `PAYPAL_SANDBOX_FIX.md`,
   `PAYPAL_TRANSFER_IMPLEMENTATION.md`).
3. The PayPal **client id** is public-by-design (ships in browser bundles);
   the paired secret must never appear anywhere client-reachable.
4. Logs are not a secrets channel: route anything sensitive through
   `utils/redact.js` (URI/error/text helpers) and keep health/error payloads
   generic.
5. Startup validation reports **variable names, never values**.

## 6. Frontend & template hygiene (whole-repo view)

- **Aspirational env templates** (K-8): `backend/env.example` advertises
  ~60 unread variables (Stripe, Razorpay, Google/FB OAuth, AWS, Redis,
  Twilio, FCM, `ENABLE_*` flags) — a real footgun: operators believe
  features exist because the template says so. `frontend/env.example`
  similarly (~50 declared, 2 read).
- **Hardcoded PayPal sandbox client-id fallback** in `PlaceOrder.tsx`
  (K-2): builds without `VITE_PAYPAL_CLIENT_ID` silently transact against
  the wrong PayPal app. Fix by always setting the env var; removing the
  literal is a code change pending approval.
- **Token in localStorage** on both frontends; no expiry handling → stale
  tokens fail opaquely (not a vuln per se, but degrades auth UX and
  encourages copy-paste debugging).
- **Admin panel**: no router guards (top-level ternary), no 404 route, no
  mobile nav; `orders.tsx` console-logs a 20-char token prefix (hygiene).
- **CSRF posture**: auth rides custom headers (not cookies), so classic
  CSRF is structurally mitigated; CORS allowlist is the enforcement point —
  keep it exact.

## 7. Dependency posture

~25 heavyweight backend dependencies are **declared but unused** (stripe,
aws-sdk, firebase-admin, twilio, redis, sentry, winston, pino, sharp, …)
plus frontend cypress/playwright/msw. They contribute audit noise and
install weight without function. Removal is queued behind the S2 remediation
plan (do not remove ad hoc — lockfiles and CI assumptions change).

## 8. Security validation status

- ✅ Automated: 43 backend suites / 441 tests (authz matrices, auth/lockout/
  password-reset contracts, webhook fail-closed + state machine, redaction
  canaries, shutdown lifecycle, index/startup contract) — canonical command in
  [07-TESTING_PLAN.md](./07-TESTING_PLAN.md) §1.
- ✅ Live gate-execution battery (2026-10-24): 27/27 feature smoke over real
  HTTP with rotated credentials + both fatal-guardrail boot proofs —
  evidence and per-item status: [docs/devops/09-GO-LIVE-GATES-EXECUTION.md](./devops/09-GO-LIVE-GATES-EXECUTION.md).
- ❓ UNVERIFIED: live PayPal sandbox end-to-end — the locally-executable
  checklist items (fail-closed proofs, topology boot, regression gate) PASS;
  the real-PayPal scenarios need owner sandbox credentials + a public HTTPS
  host (checklist: `docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`).
- ⛔ Blocked on owner: remaining provider-credential rotations + canonical-repo
  history purge (S1) — the only pre-production blockers that remain.
- Phase 1 gate decision (preserved): **CONDITIONAL GO** on the owner
  actions above (`docs/devops/05-PHASE1-COMPLETION-REPORT.md` §7).
