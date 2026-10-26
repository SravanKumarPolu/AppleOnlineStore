# 07 — Credential Rotation Runbook (Pre-Production Blocker: *Owner action required*)

**Status:** READY — all code-side prerequisites are in place. The remaining steps
require PayPal Developer Dashboard / hosting-provider access that only the
repository owner holds.

**Why rotation is required before launch:** the credentials currently in use
were created during Phase 1 development and have circulated through local
environments, test scripts, and terminals. Treat them as exposed until rotated.

**Second-pass exposure finding (2026-10-26):** a previously distributed NovaCart
ZIP archive contained `backend/.env` with populated values. The file was
Git-ignored, but archives built from the working directory include ignored
files — so every populated credential in that archive must be treated as
disclosed. `backend/scripts/verify-distribution.mjs` now refuses to build an
archive containing `.env`/key material (locked by `distributionArchive.spec.js`).
Removing a file from a new archive does **not** un-expose the old one.

**Third-pass execution (2026-10-26, later):** `JWT_SECRET` and `ADMIN_PASSWORD`
were **re-rotated locally and live-verified**, closing the "archive age"
question by simply rotating again (evidence below). `ADMIN_PASSWORD` had
also degraded to a **9-character value** — now a generated 20-character one.
The new values live only in `backend/.env` (now mode `0600`); they are never
printed, committed or archived. Read them directly from that file when needed.

**Credential status (evidence-based, updated 2026-10-26 third pass):**

| Credential | Classification | Evidence / required action |
|---|---|---|
| `JWT_SECRET` | ✅ **VERIFIED ROTATED (2026-10-26, second rotation)** | Live-verified on this machine: pre-rotation admin JWT → **401** on `/api/orders/all`; old password → **401** on `/api/user/admin`; new pair → **200** on both; `/health/ready` → **200** after rotation (status codes only — values never printed). All sessions are invalidated by design |
| `ADMIN_PASSWORD` | ✅ **VERIFIED ROTATED (2026-10-26, second rotation)** | Same live verification; replaced a weak 9-char value with a generated 20-char one. Read the new value from `backend/.env` — do not paste it anywhere |
| `PAYPAL_CLIENT_SECRET` | ⚠️ **ROTATION REQUIRED** (sandbox; live creds are created fresh anyway) | Current sandbox secret still works (a sandbox order was created with it on 2026-10-26, no charge), but an **older secret value sits in a dangling git blob** (below) — treat as disclosed. **Incident (2026-10-26 ~16:37):** the freshly-issued id **and secret** were pasted into the TRACKED templates `frontend/.env.example` + `frontend/env.example`; removed the same hour, **never staged or committed** (verified: nothing in the index, `git log -S` empty). The id is public-by-design and already lives in `backend/.env` + git-ignored `frontend/.env`; the secret lives only in `backend/.env`. Dashboard → Apps & Credentials → generate new secret → update `.env` → verify with `npm run paypal:sandbox -- --check` + `--create` (§2.1) |
| `PAYPAL_WEBHOOK_ID` | ⚠️ **ROTATION REQUIRED / BLOCKED** | Not configured here; create the sandbox webhook (see `docs/devops/08`) and set it — every webhook is rejected until then |
| `MONGODB_URI` password | ⚠️ **ROTATION REQUIRED — CONFIRMED STILL LIVE** | 2026-10-26: the current URI (Atlas, `mongodb+srv`, embedded credentials) **connects successfully**, and the identical value sits in a **dangling git blob** in this checkout. Atlas → Database Access → edit user password → update `MONGODB_URI` → verify (§2.5 + verify commands below) |
| `CLOUDINARY_SECRET_KEY` | ⚠️ **ROTATION REQUIRED — CONFIRMED STILL LIVE** | 2026-10-26: the identical live value sits in the same dangling git blob. Cloudinary console → API Keys → regenerate → update `CLOUDINARY_SECRET_KEY` → verify (§2.6 + verify commands below) |
| `SMTP_PASS` | 🟡 **CONDITIONAL** | **Not present** in the current `backend/.env` — nothing to rotate here. If the distributed ZIP's `.env` contained SMTP values, revoke that app-password at the provider (§2.7) |
| `PAYPAL_CLIENT_ID` | ✅ VERIFIED NOT EXPOSED (by design) | Public identifier shipped in the storefront bundle (also copied into the git-ignored `frontend/.env` on 2026-10-26 so the sandbox buttons render); not a secret |
| PayPal payer/card data | ✅ VERIFIED NOT EXPOSED | Never stored by the application (the sandbox helper logs ids/amounts only) |

Historical Git exposure in *this* checkout: the working tree and full history
scan clean (`npm run security:secrets`, 2026-10-26). The canonical repository's
history purge remains an owner decision (`git-filter-repo`, force-push) and is
**not** performed automatically; rotation is required regardless of history.

**Dangling-object finding (2026-10-26) — owner purge required**

`scan-secrets --history` walks **refs**, so it cannot see unreachable objects.
A non-destructive `git fsck --unreachable --no-reflogs` audit found **two
dangling blobs** holding credential assignments; one of them (`e8f6c66d…`)
contained the then-live JWT secret, admin password, **MongoDB Atlas URI and
Cloudinary secret**. After the local re-rotation above, only the **MongoDB and
Cloudinary values remain live** inside that blob. Dangling objects never leave
this machine via push/clone/`git archive` — the exposure is local-disk only —
but they should be purged.

**Owner purge (irreversible, NOT a history rewrite — no refs change, no
force-push; run only after the external rotations so the blob content is
already dead):**

```bash
cd /Users/Projects/NovaCart
# re-check what is still unreachable (read-only)
git fsck --unreachable --no-reflogs
# purge ALL unreachable objects (reflog entries keep objects alive, so expire first)
git reflog expire --expire=now --all
git gc --prune=now
# confirm: expect zero dangling blobs with credential findings
```

**Template-file rule (2026-10-26 incident):** `*.env.example` / `env.example`
files are **tracked** — they ship in every archive and commit. Never paste real
values into them; real credentials belong **only** in git-ignored `.env` files.
The scanner + distribution gate now cover the whole repo (they were silently
scoped to `backend/` before — see the control-defect note below), so a repeat
would fail the gate immediately.

**Control defect (found + fixed 2026-10-26):** `git ls-files`, `git log` and
`git archive` are **cwd-scoped** — run from `backend/` (where the npm scripts
execute), both security gates silently covered only `backend/**` (106 of 482
tracked files) and a "release" archive shipped backend-only content. Fixed:
both scripts anchor at the repo toplevel; regression specs assert a secret in
`frontend/` is caught even when the CLI runs from `backend/`, and that an
archive built from a subdirectory contains the whole repo. The whole-repo
history scan also surfaced this checkout's **agent checkpoint refs**
(`refs/agents/…/checkpoints/turn/0–3`): their snapshots contain only
**synthetic** values (the startup verifier's `verify-*` boot string and an
**expired** fabricated mock JWT — waived by the new expiry-aware rule), so no
live credential hides there either.

**Post-rotation verification commands (run after each provider change — output
never includes values):**

> **2026-10-26 fourth-pass addendum.** Two of the ad-hoc snippets below are not
> safe to copy blindly: the inline `OLD_URI=…` one is a malformed double `node`
> invocation, and printing anything from a live credential is exactly what this
> runbook forbids. Use the scripts that now implement the same checks
> (value-free by construction):
>
> ```bash
> cd backend
> # current vs previously-exposed value, per provider (MongoDB, Cloudinary,
> # PayPal OAuth, JWT/admin): current WORKS / exposed REVOKED, or exit 1
> npm run security:rotation -- --exposed-blob e8f6c66d
> # functional negative test: old admin password and old JWT secret must 401,
> # current pair must 200 (boots the real app on an in-memory database)
> npm run verify:old-credentials -- --exposed-blob e8f6c66d
> # unreachable git objects that still hold a live credential (trap 22)
> npm run security:dangling
> ```
>
> They take `--exposed-env <file>` when the exposed values live outside git.

**Verified credential status (2026-10-26, fourth pass — provider round-trip):**

| Credential | Current value | Exposed copy | Classification |
|---|---|---|---|
| `JWT_SECRET` | accepted (login → 200) | token signed with it → **401** | ✅ **VERIFIED ROTATED** |
| `ADMIN_PASSWORD` | login → 200 | login → **401** | ✅ **VERIFIED ROTATED** |
| `PAYPAL_CLIENT_SECRET` | OAuth token → **200** | OAuth token → **401** | exposed copy **REVOKED**; rotate the current secret anyway (it was pasted into tracked templates on 2026-10-26, §17.11) |
| `PAYPAL_WEBHOOK_ID` | absent | — | ⛔ **BLOCKED** — no webhook exists; every webhook is rejected until one is created |
| `MONGODB_URI` | ping → **ok** | **identical to current, ping ok** | ❌ **NOT ROTATED — OWNER ACTION** |
| `CLOUDINARY_SECRET_KEY` | ping → **ok** | **identical to current, ping ok** | ❌ **NOT ROTATED — OWNER ACTION** |
| `SMTP_PASS` | absent | absent | nothing to rotate on this machine |
| `PAYPAL_CLIENT_ID` | works | public by design | not a secret |

**Operational trap found and fixed the same day:** the backend process that was
listening on `:3001` had started at 13:46, before the 16:52 rotation, so it still
held the **old** JWT secret and admin password in memory: the old password
returned **200** and the new one **401** against that process. It was stopped and
restarted from the rotated `.env` (old → 401, new → 200, `/health/ready` → 200).
The storefront dev server was restarted too so `frontend/.env` (16:55) is
actually loaded. **A rotation is not in effect until every process that read the
old environment is restarted** — deploy/restart as part of the rotation, and
re-run `npm run verify:old-credentials` afterwards.

```bash
# MongoDB — new credential works? (expect: NEW MongoDB credential: WORKS)
cd backend && node --input-type=module -e 'import mongoose from "mongoose"; import {config} from "dotenv"; config(); try { await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:8000}); console.log("NEW MongoDB credential: WORKS"); await mongoose.disconnect(); } catch (e) { console.log("NEW MongoDB credential: FAILED (" + e.name + ")"); }'

# MongoDB — old credential is dead? (run ONCE with the old URI pasted into your
# own terminal; it is never echoed. expect: OLD MongoDB credential: FAILED)
OLD_URI="<paste the pre-rotation URI here>"; node --input-type=module -e 'import mongoose from "mongoose"; try { await mongoose.connect(process.env.OLD_URI,{serverSelectionTimeoutMS:8000}); console.log("OLD MongoDB credential: STILL WORKS — ROTATION INCOMPLETE"); await mongoose.disconnect(); } catch (e) { console.log("OLD MongoDB credential: FAILED (dead, as intended)"); }' \
  OLD_URI="$OLD_URI" node --input-type=module -e 'import mongoose from "mongoose"; try { await mongoose.connect(process.env.OLD_URI,{serverSelectionTimeoutMS:8000}); console.log("OLD MongoDB credential: STILL WORKS — ROTATION INCOMPLETE"); await mongoose.disconnect(); } catch (e) { console.log("OLD MongoDB credential: FAILED (dead, as intended)"); }'

# Cloudinary — new credential works? (expect: Cloudinary credential: WORKS)
cd backend && node --input-type=module -e 'import cloudinary from "cloudinary"; import {config} from "dotenv"; config(); cloudinary.v2.config({cloud_name:process.env.CLOUDINARY_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_SECRET_KEY}); cloudinary.v2.api.ping((err,res)=>{console.log(err?"Cloudinary credential: FAILED ("+err.name+")":"Cloudinary credential: WORKS (ping "+res.status+")");process.exit(err?1:0);});'

# PayPal — sandbox secret works + config complete? (--check must exit 0; --create must print a CREATED order, no charge)
cd backend && npm run paypal:sandbox -- --check && npm run paypal:sandbox -- --create

# App-level regression after ANY credential change:
cd backend && npm run verify:startup && npm run test:security
```

Baseline evidence from 2026-10-26: the MongoDB command printed `WORKS` and the
Cloudinary command printed `WORKS (ping ok)` against the **pre-rotation**
values — proving both checks are valid and that those credentials were still
live at that moment.

---

## 1. What the code already enforces (no action needed)

These guardrails shipped with this runbook — rotation can rely on them:

| Guardrail | Where | Behavior |
|---|---|---|
| Single PayPal environment switch | `backend/config/paypalEnv.js` | `PAYPAL_ENV=live` is the ONLY way any code path targets live PayPal; capture flow and webhook verifier can never disagree |
| Startup credential validation | `backend/config/startupValidation.js` + `server.js` | Boot **refuses to start (exit 1)** when `PAYPAL_ENV=live` has missing/placeholder `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_WEBHOOK_ID`, or when `NODE_ENV=production` has a missing/placeholder `JWT_SECRET` |
| Environment-agreement warnings | same | Loud `🚨 CONFIG WARNING` when `NODE_ENV=production` runs sandbox PayPal (or live credentials run in a non-prod build) |
| Webhook fail-closed verification | `services/paypalWebhookService.js` | A wrong/rotated `PAYPAL_WEBHOOK_ID` fails CLOSED: events are rejected (400), never silently accepted |
| Unmatched-capture recovery | `controllers/orderController.js` | A credential flip mid-flight cannot strand a payment: unmatched captures defer + retry (bounded), mismatches alert |

Startup report lines look like this (values are never printed, only names):

```
🔧 STARTUP CONFIG: PayPal environment: LIVE
🚨 CONFIG WARNING: PAYPAL_WEBHOOK_ID is not set — every incoming webhook fails ...
```

## 2. Credential inventory & rotation procedures

Every credential is env-driven — nothing is hardcoded in the repo (audited:
`rg 'process\.env\.(PAYPAL|JWT|ADMIN|MONGO|SMTP|CLOUDINARY)' backend/` finds all
usages; no secret literals exist in `backend/`, `frontend/src/`, or `admin/src/`).

### 2.1 PayPal REST credentials — `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (CRITICAL)

1. PayPal Developer Dashboard → **Apps & Credentials** → ensure the **Live** tab is selected (not Sandbox).
2. Either **Create App** (recommended — gives a clean break from dev-era keys) or **Show** → **Generate new client secret** on the existing app.
3. Update the two values in the production `.env` (secret manager — never a committed file).
4. `PAYPAL_ENV=live` must be set in the same deploy (see §3).
5. Redeploy. The server boots only if both values are real (placeholders abort startup).
6. **Verify:** place a minimal live test order, capture it, and confirm the order flips to `paymentStatus: completed` in the DB and the webhook arrives verified (log line: webhook processed, result `order_updated`).
7. **Rollback:** keep the old app credentials valid until the new pair is verified; if capture fails, revert the two env values and redeploy.

> The old secret stops working the moment a new one is generated — do the
> generate + deploy in one maintenance window.

### 2.2 PayPal webhook — `PAYPAL_WEBHOOK_ID`

1. Dashboard → **Apps & Credentials → [your app] → Webhooks → Add Webhook** (live tab).
2. Subscribe to at minimum: `PAYMENT.CAPTURE.COMPLETED` (add `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.ORDER.COMPLETED` if those flows are used).
3. Webhook URL: `https://<production-domain>/api/orders/paypal/webhook` (HTTPS only — PayPal rejects plain HTTP).
4. Copy the **Webhook ID** into `.env` as `PAYPAL_WEBHOOK_ID`.
5. Redeploy, then use the Dashboard's **Send test event** (or the sandbox checklist, doc 08) and watch the backend log for a verified `order_updated` / `ignored_event_type` outcome — anything else means the ID or URL is wrong.

> If the webhook is ever DELETED and recreated, its ID changes — the new ID must
> be deployed, or all webhooks fail-closed (rejected 400) until then. That is
> the safe direction (no spoofed events pass), but payments stop updating orders,
> so treat webhook-ID changes with the same urgency as the client secret.

### 2.3 `JWT_SECRET`

1. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
2. Replace in `.env`, redeploy.
3. **Blast radius (expected):** every existing user + admin session token becomes invalid; all users are logged out and simply log back in. No data is lost.
4. Verify: login works, `Authorization: Bearer <token>` requests return 200, and a pre-rotation token now returns 401.

### 2.4 Admin login — `ADMIN_EMAIL` / `ADMIN_PASSWORD`

1. Set a strong unique value for each in `.env`, redeploy.
2. **Blast radius:** outstanding admin tokens stop authorizing (the admin middleware compares the token payload against these values), forcing a fresh admin login. Intended.
3. Verify: `POST /api/user/admin` (the real route) accepts the new pair; the old pair is rejected.
4. **Verified correction (2026-10-26, `middleware/auth.js`):** the admin JWT
   payload is `{email, role:'admin', type:'admin'}` — it does **not** carry the
   password, and `authAdmin` does **not** re-compare the password; it only
   verifies the signature. So a password-only rotation leaves already-issued
   admin tokens valid until their 1-day `exp`. Rotate `JWT_SECRET` in the same
   window (that is what invalidates tokens) or accept the residual validity
   window. `npm run verify:old-credentials` asserts both halves (old password →
   401, token signed with the old secret → 401).

### 2.5 `MONGODB_URI` (if the Phase 1 dev database was shared)

Rotate the database user's password in Atlas → update URI → redeploy. Verify via
`/health/ready` and a successful order read. If production data already lives in
the Phase 1 database, migrate first, then rotate.

### 2.6 Optional integrations — `SMTP_*`, `CLOUDINARY_*`, social OAuth keys

Rotate per provider if they were used during Phase 1. The startup validator warns
about missing/placeholder values of the core set only; these are functional, not
security-blocking, if unused at launch.

## 3. The environment switch — `PAYPAL_ENV` (new, unified)

Before this runbook the capture flow chose live/sandbox from `NODE_ENV` while the
webhook verifier used `PAYPAL_ENV`. They could disagree (prod build + unset
`PAYPAL_ENV` = live captures + sandbox-verified webhooks = every webhook
rejected = orders stuck pending). Now **one** variable drives **both**:

```bash
# production .env — real money
NODE_ENV=production
PAYPAL_ENV=live
PAYPAL_CLIENT_ID=<live id>        # live tab credentials
PAYPAL_CLIENT_SECRET=<live secret>
PAYPAL_WEBHOOK_ID=<live webhook id>

# staging .env — safe validation topology (logs a visible warning, boots fine)
NODE_ENV=production
PAYPAL_ENV=sandbox                # explicit choice, warning confirms it
PAYPAL_CLIENT_ID=<sandbox id>     # sandbox tab credentials
PAYPAL_CLIENT_SECRET=<sandbox secret>
PAYPAL_WEBHOOK_ID=<sandbox webhook id>
```

## 4. Post-rotation go-live gate

- [ ] Server log shows `🔧 STARTUP CONFIG: PayPal environment: LIVE` and **zero** `🚨 CONFIG WARNING` / `🛑 FATAL CONFIG` lines
- [ ] `/health/ready` returns 200
- [ ] Live capture test: order reaches `paymentStatus: completed` via webhook (`result: order_updated` in logs), not just via the capture endpoint
- [ ] Admin panel login works with the new credentials
- [ ] Old credentials rejected (a pre-rotation JWT returns 401; old admin pair fails)
- [ ] Log pipeline alerts on `🚨 PAYMENT WEBHOOK ALERT` and `🚨 CONFIG WARNING` patterns

Once all boxes tick, the *credential rotation* blocker is CLOSED. Pair with
`08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md` (run it in sandbox topology first),
and Phase 1 is production-ready.
