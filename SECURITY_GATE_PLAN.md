# NovaCart — Phase 1 Security Gate: Audit Findings & Remediation Plan

Status: **DRAFT FOR APPROVAL** — audit complete, no security changes applied yet.
Date: 2026-10-23 · Auditor: automated audit + manual code review (all findings verified by execution or file inspection)

Scope: `frontend/`, `admin/`, `backend/`, git history, distributed archives.
This is the security portion of Phase 1, separate from the (now complete)
linting/testing milestone — see `PHASE1_LINTING_TESTING_REPORT.md`.

---

## 1. Gate criteria (what "security gate passed" means)

1. All **P0** findings remediated and verified (credential rotation confirmed,
   zero critical/high advisories or each risk formally accepted in writing).
2. All **P1** findings fixed with regression tests.
3. Full validation suite re-run green: lint 0/0 ×3, `tsc --noEmit`, frontend
   26/26 vitest, backend 7/7 categories (ephemeral infra runner), all builds.
4. Checklist sign-off recorded in this document.

---

## 2. Findings

### P0 — Critical (act immediately)

**S1. Live credentials distributed in archives & embedded in git object store.**
- `backend/.env` holds real PayPal client secret, Cloudinary API secret,
  128-char JWT secret, admin email+password. `frontend/.env` / `admin/.env`
  expose the PayPal client id and API URLs.
- Git: `HEAD` does **not** track `.env` (`.gitignore` is correct), but a
  **dangling commit `9d36bce`** ("Agent host session baseline checkpoint")
  added `backend/.env` to history, and its content is byte-identical to the
  current real file (sha256 match). Anyone with the original 49 MB ZIP
  (which contained `.git/`) can recover the plaintext secrets two ways.
- The delivered clean ZIP excludes `.git/` but — per prior approval — still
  includes the real `.env` files.
- **Remediation (owner: repo owner — rotation cannot be done by tooling):**
  1. Rotate: PayPal client secret, Cloudinary API key/secret, JWT secret,
     admin password, SMTP credentials if used.
  2. Purge dangling commit: `git reflog expire --expire=now --all && git gc
     --prune=now --aggressive`, then verify `git fsck --lost-found` shows no
     reachable copy; or re-init history (`git checkout --orphan clean`).
  3. Re-distribute archives only with `.env.example` (already placeholder-only,
     verified) and never with `.git/`.
  4. Add a pre-archive lint step (e.g. `git archive` from a clean branch).

**S2. Dependency vulnerabilities (verified via `npm audit`).**
- backend **64** (5 critical, 32 high) · frontend **55** (5 critical, 32 high)
  · admin **22** (1 critical, 15 high).
- Criticals are transitive: `fast-xml-parser`, `protobufjs`, `proxy-addr`,
  `tar`, `websocket-driver`. High-impact direct chains: `express`
  (path-to-regexp), `mongoose`, `multer`, `nodemailer`, `axios`, `sharp`,
  `joi`, `compression`, `lodash` (note: top-level versions are recent —
  express 4.21.2, mongoose 8.16.5, multer 2.0.2, axios 1.11.0, nodemailer
  6.10.1 — most findings are transitive/dev-tree).
- **Remediation:** per package `npm audit fix` (non-breaking) → re-audit →
  targeted minor/major bumps for the remainder → re-run the full validation
  suite (now meaningful: 26 frontend tests + 7 backend categories). Any
  risk-accepted residual must be listed here with justification.

### P1 — High

**S3. Env-based admin account with plaintext password & non-timing-safe compare.**
- `userController.adminLogin` compares `email === process.env.ADMIN_EMAIL &&
  password === process.env.ADMIN_PASSWORD` (plaintext in `.env`, `===`
  comparison). Admin identity is env config, not a DB user with a bcrypt hash.
- **Fix:** seed an admin user (hashed) at startup or first login; compare with
  `bcrypt.compare`; keep env fallback only for bootstrap. Add
  `crypto.timingSafeEqual` for any remaining direct compares.

**S4. No token revocation; 7-day user tokens.**
- User JWTs live 7 days; password change / "logout all devices" cannot
  invalidate issued tokens.
- **Fix:** add a `tokenVersion` (or `passwordChangedAt`) field to the user
  document; reject tokens issued before it in `authUser`/`protect`. Optionally
  shorten default expiry to 24–48 h.

### P2 — Medium / hygiene

| ID | Finding | Fix |
|----|---------|-----|
| S5 | `adminAuth.js` is dead code AND buggy (expects `token_decode.password`, which the real admin token never carries — would reject every valid admin token if ever wired up) | Delete it in the auth consolidation below |
| S6 | Three parallel auth middlewares (`auth.js` ≈ `authMiddleware.js` duplicates + dead `adminAuth.js`) | Consolidate to one module, re-export aliases, keep route behavior identical; covered by backend integration suite |
| S7 | `jwt.verify` without pinned `algorithms` | Pin `algorithms: ['HS256']` at all 6 call sites |
| S8 | `hpp` not installed (HTTP parameter pollution) | `npm i hpp` + `app.use(hpp())` after body parsing |
| S9 | Multer trusts `mimetype` only (spoofable; no magic-byte check) | Validate uploaded bytes via `sharp`/`file-type` before persisting |
| S10 | JWT stored in `localStorage` (XSS can exfiltrate) | Documented tradeoff; option: httpOnly cookie + CSRF token — needs UX sign-off |
| S11 | `dist/`, `dev-dist/` committed at HEAD; tooling can create dangling commits (root cause of S1) | Untrack build outputs; CI-side secret scanning (gitleaks) as pre-commit hook |
| S12 | 3 npm scripts reference missing files (`db:seed`, `db:migrate`, `email:test`) | Implement or remove scripts (reliability gate also tracks this) |
| S13 | CSP allows `'unsafe-inline'` styles | Nonce/hash-based styles if hardening desired |
| S14 | Socket auth (`socketService`) verifies token but role/authorization checks are minimal | Review room join authorization for order/inventory rooms |

### Already in place (verified — no action)

- helmet 8 with CSP directives; CORS allow-list (localhost + deployed origins +
  env URLs); dual rate limiting (global 1000/15 min; auth 20/15 min);
  `express-mongo-sanitize`; `express-validator` on user/product routes;
  bcrypt hashing (12 rounds default); JWT secret 128 chars; multer
  MIME allow-list + size limits; admin token 1-day expiry; `.gitignore`
  excludes `.env` with `!.env.example`; `.env.example` files are
  placeholder-only (verified — no leaked values); email templates now load
  with fallbacks (fixed this session, §7 of the linting report).

---

## 3. Proposed execution order (upon approval)

| Wave | Items | Est. effort | Verification |
|------|-------|-------------|--------------|
| 0 | S1 rotation + git purge (owner action; we provide commands) | hours (creds) | `git fsck` + fresh clone audit |
| 1 | S2 `npm audit fix` + targeted bumps | 0.5–1 day | audit 0 critical/high + full suite |
| 2 | S3 admin bcrypt + S4 token revocation + S7 pinned algos | 1 day | new backend tests + 7/7 suite |
| 3 | S5/S6 auth consolidation, S8 hpp, S9 upload sniffing | 0.5 day | lint + integration suite |
| 4 | S10–S14 tracked as backlog with owners | — | per item |

Constraints honored: no UI redesign, no Docker/AWS, no business-logic
rewrites; every change re-verified with the existing validation matrix.

## 4. Sign-off

| Item | Status |
|------|--------|
| P0 S1 (secrets rotation) | ⏳ Owner action required |
| P0 S2 (dependencies) | ⏳ Pending approval |
| P1 S3–S4 | ⏳ Pending approval |
| P2 backlog | ⏳ Pending approval |
| Full-suite re-run after changes | ⏳ Not yet applicable |
