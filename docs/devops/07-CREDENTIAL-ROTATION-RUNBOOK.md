# 07 — Credential Rotation Runbook (Pre-Production Blocker: *Owner action required*)

**Status:** READY — all code-side prerequisites are in place. The remaining steps
require PayPal Developer Dashboard / hosting-provider access that only the
repository owner holds.

**Why rotation is required before launch:** the credentials currently in use
were created during Phase 1 development and have circulated through local
environments, test scripts, and terminals. Treat them as exposed until rotated.

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
3. Verify: `/api/admin/login` accepts the new pair; the old pair is rejected.
4. *Known hardening backlog item (not a launch blocker):* the admin JWT carries the password in its payload (base64, not encrypted). Rotating the password regularly limits exposure; a refactor to opaque admin tokens is recommended post-launch.

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
