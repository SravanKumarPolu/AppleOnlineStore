# 09 — Go-Live Gates Execution Report (Credential Rotation + Sandbox Validation)

**Date:** 2026-10-24
**Scope:** Advance the two remaining pre-production blockers
(`docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md`, `docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`)
to the maximum extent possible **from this environment**, with a full
no-damage verification battery. Provider-dashboard actions that only the
repository owner can perform are itemized as REMAINING — they cannot be
executed by tooling, by design.

**Bottom line:**

| Gate | Before | After this execution |
|---|---|---|
| Credential rotation (S1) | ⛔ fully owner-blocked | 🟡 **locally-rotatable credentials ROTATED + live-verified** (JWT_SECRET, ADMIN_PASSWORD); provider credentials + canonical-repo history purge remain owner actions |
| PayPal sandbox validation | ❓ not started | 🟡 **all locally-executable checklist items executed and PASS** (fail-closed proofs, topology boot, regression gate); real-PayPal scenarios remain ❓ owner-pending (need sandbox creds + public HTTPS host) |

---

## 1. Credential rotation — what was executed

### 1.1 Rotated credentials (FINAL, live-verified)

| Credential | Action | Verification (runbook §2.3–2.4 steps, executed) |
|---|---|---|
| `JWT_SECRET` | New 128-char base64url value generated (`node:crypto`, 96 random bytes) and installed in `backend/.env` | Fresh token → `GET /api/user/profile` **200**; a JWT signed with a **pre-rotation-style secret** → **401** (rotation effective — old sessions cannot authenticate) |
| `ADMIN_PASSWORD` | New 22-char value generated (env-safe alphabet) and installed in `backend/.env` | `POST /api/user/admin` with the **new pair → 200 + token**; wrong password → **401** |

The generated values live only in:

- `backend/.env` — runtime config, **gitignored** (verified: `git check-ignore`
  matches; `git status` shows neither file)
- `NovaCart-rotated-backend.env.local` — owner handoff in the delivery folder,
  **gitignored** via a `download/*.local` pattern added to the workspace
  `.gitignore` (verified) so the platform's auto-checkpoint commits can never
  pick it up

Neither file is included in any repository zip. Values are never printed in
logs (verified by the smoke battery's leak checks — §3).

### 1.2 Guardrail live proofs (runbook §1, executed as real boots)

| Simulated misconfiguration (with the rotated `.env` present) | Result |
|---|---|
| `PAYPAL_ENV=live` + guardrail-recognized placeholder PayPal creds | **exit 1 before any connection opens** — three `🛑 FATAL CONFIG` lines (client id / secret / webhook id), then "Refusing to start" |
| `NODE_ENV=production` + missing `JWT_SECRET` | **exit 1** — `🛑 FATAL CONFIG: JWT_SECRET is not set …` |

Operational note discovered during proof A: `isPlaceholder()`
(`config/startupValidation.js`) recognizes only values matching
`^(your|change|replace|placeholder|example|todo|fixme)[-_*]` (plus an exact
set). The rotated `.env` therefore uses `replace-me-paypal-*` values — an
owner who flips `PAYPAL_ENV=live` before supplying real credentials gets an
**unbootable server**, not a broken live deployment. Do not "fix" this by
using arbitrary placeholder strings.

### 1.3 Environment template corrections found by execution

- **`MONGODB_URI` must NOT contain a database name**: `config/mongodb.js`
  appends `/e-commerce` itself. A value like
  `mongodb://localhost:27017/novacart` produces the invalid namespace
  `novacart_smoke/e-commerce` and 500s on every DB-backed request. The
  rotated `.env` ships `mongodb://localhost:27017` (matching
  `backend/.env.example`). The aspirational root `env.example` documents it
  wrongly (K-8 pattern).
- The sandbox checklist's "exactly one warning" expectation for a
  `NODE_ENV=production` + sandbox topology was confirmed by the guardrail
  proof-B boot output (single sandbox-in-prod warning, one FATAL for the
  missing JWT, nothing else).

### 1.4 Git-history leak — precise scope (forensics)

- **This working copy is clean:** `git log --all` shows `backend/.env` and
  `server.log` were **never committed** here; the leak references from
  `SECURITY_GATE_PLAN.md` §S1 (dangling commit `9d36bce`, checkpoint refs
  `7855434`, pushed `main@00b08de`) **do not exist** in this repository
  (`git cat-file -t` fails for all three; no remote is configured).
- The leak therefore lives only in the **owner's canonical repository** and
  the **original 49 MB distribution ZIP** (which contained `.git/`) — exactly
  as `SECURITY_GATE_PLAN.md` §S1 records.
- Every archive delivered from this environment since Task 1 excludes `.git/`
  and contains no `.env` files — the "interim path" (deploy from clean
  archives) documented in `docs/06-DEPLOYMENT.md` §5 is already satisfied.

### 1.5 REMAINING — owner dashboard actions (cannot be done by tooling)

| Credential | Procedure | Note |
|---|---|---|
| PayPal client secret (+ live webhook ID) | runbook §2.1–2.2 | generate + deploy in one window; old secret dies at generation |
| MongoDB Atlas user password | runbook §2.5 | rotate in Atlas, then set the new `MONGODB_URI` (no db name!) |
| Cloudinary API key/secret | runbook §2.6 | optional unless used |
| SMTP credentials | runbook §2.6 | optional unless used |
| **Canonical-repo history purge** | `SECURITY_GATE_PLAN.md` §S1: `git reflog expire --expire=now --all && git gc --prune=now --aggressive`, verify `git fsck --lost-found` shows no reachable copy — or re-init history (`git checkout --orphan`); then re-distribute archives **without `.git/`** | the dangling commit `9d36bce` (byte-identical `backend/.env`) is recoverable by anyone holding the original ZIP until purged |
| `ADMIN_EMAIL` | set the real operator address in `.env` (currently `admin@novacart.local`) | cosmetic before first real login |

Correct endpoint note for runbook §2.4's verification step: the admin login
endpoint is `POST /api/user/admin` (the runbook's `/api/admin/login` is a
documentation slip in the preserved doc).

---

## 2. PayPal sandbox validation — per-item status

Checklist: `docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`. Items
below were executed against a **real boot of `server.js`** (rotated env,
local MongoDB 7.0.14, sandbox topology). Real-PayPal items need sandbox
credentials and a public HTTPS host (tunnel) that only the owner can provide.

| Checklist item | Status | Evidence |
|---|---|---|
| §0 topology boot — SANDBOX banner, expected warnings only | ✅ Executed | startup report: `PayPal environment: SANDBOX`, **zero FATAL**; sandbox+placeholder creds boot (placeholders are fatal only when `PAYPAL_ENV=live`) |
| §2 fail-closed — invalid signature / malformed body | ✅ Executed | empty body → **400**; forged PayPal headers (fake signature, fake cert URL) → **400**, no DB change; reason `verification_request_failed` — the endpoint rejects anything it cannot verify |
| §7 full regression run | ✅ Executed | backend **11 suites / 101 tests PASS**; frontend **8 files / 26 tests PASS**; ESLint clean ×3; frontend PWA build (103 precache entries); admin build — all **with the rotated `.env` present** |
| §1 happy path (sandbox buyer checkout → capture → verified webhook) | ⛔ Owner | requires real sandbox app credentials + public HTTPS webhook URL |
| §3 / §3a unmatched-capture deferral, reconciliation, retry exhaustion | ⛔ Owner | requires **real** PayPal deliveries; the underlying behavior is regression-tested with mocks (`webhookUnmatchedCapture`, 8 tests) |
| §4 amount/currency/identity gates with real captures | ⛔ Owner | same; mocked coverage in `webhookUnmatchedCapture` + `captureEndpointVerification` |
| §5 capture endpoint vs real PayPal + race sweep | ⛔ Owner | mocked coverage in `captureEndpointVerification` (4 tests) |
| §6 real duplicate/concurrent deliveries | ⛔ Owner | mocked coverage in `webhookIdempotency` (9 tests) |

**Gate status after this execution:** the mock-level evidence for every
scenario is green and re-confirmed; the gate remains ❓ **UNVERIFIED** in the
checklist's own sense — real-PayPal end-to-end — until the owner runs the ⛔
items on a staging host. That is precisely what the checklist was designed to
prove (mocks only ever validate the code, never PayPal's side).

## 3. No-damage verification battery (the "nothing else broken" proof)

**No application source file was modified during gate execution** — changes
were limited to gitignored env files, workspace-level scripts, and
documentation. The battery:

1. **Live feature smoke — 27/27 PASS** (real HTTP against a real boot):
   health trio + `/api/socket/status`; admin auth (new creds 200 / wrong 401);
   shopper register 201 / login 200 / profile 200; stale-secret JWT 401;
   product list; cart add; **COD order via API 200** (order visible to admin,
   status advance → `Packing` 200, invalid enum → 400 whitelist); shopper
   order history 200; webhook fail-closed 400 ×2; startup report sanity;
   **admin password and JWT never appear in logs**.
2. **Backend:** 11 suites / 101 tests PASS; ESLint clean.
3. **Frontend:** ESLint clean; `tsc --noEmit` clean; 8 files / 26 tests
   PASS; PWA build OK.
4. **Admin:** ESLint clean; build OK.

Reproduction (any host): boot `backend` against any MongoDB (URI without db
name), then run the checks above — the full battery script used here is kept
at the workspace level (`scripts/gate_smoke.sh`, secret-free output).

## 4. Sign-off state

- Rotation gate: **partially closed** — closes fully when §1.5's dashboard
  rotations + canonical-repo purge are done (verify via runbook §4 gate).
- Sandbox-validation gate: **still open (❓)** — closes when §2's ⛔ items
  run on a staging host; all locally-provable prerequisites are green.
- Everything else (features, tests, builds) verified intact after execution.
