# NovaCart — Final Stabilization & Production-Readiness Report

**Date:** 2026-10-26 · **Branch:** `main` (working tree changes uncommitted) ·
**Decision:** **CONDITIONAL PASS** — the code gates pass, but production
release is **not** authorised while the PayPal sandbox lifecycle and provider
credential rotation remain unresolved.

> Rule applied: only what was executed is reported as verified. External
> dependencies that could not be exercised are marked **BLOCKED**, never
> inferred from mocks.

---

## 1. What was inspected

**Applications:** `backend/` (Express/Mongoose/Socket.IO), `frontend/`
(React/Vite PWA), `admin/` (React/Vite).

**Backend code:** `controllers/orderController.js` (place/capture/webhook/
refund/status), `services/reservationService.js`, `services/socketService.js`,
`services/paypalWebhookService.js`, `config/{startupValidation,paypalEnv}.js`,
`models/orderModel.js`, `models/webhookEventModel.js`, `middleware/auth.js`,
`routes/orderRoute.js`, `app.js`, `server.js`.

**Scripts:** `paypal-sandbox-check.mjs`, `scan-secrets.mjs`, `load-test.mjs`,
`e2e-server.mjs`, `verify-startup.mjs`.

**Tests:** all 41 backend specs (focus: `refundWorkflow`,
`reservationExpiry`, `socketRealtime`, `webhookIdempotency`,
`webhookUnmatchedCapture`, `captureEndpointVerification`,
`inventoryPricingIntegrity`, `concurrencyRaceConditions`), frontend unit
suites, 3 Playwright specs.

**Docs:** `AGENTS.md`, `README.md`, `docs/01`–`09`, `docs/devops/00`, `07`,
`08`, `09`, the existing load artifact and `.env.example` files.

## 2. Reused unchanged (verified sufficient)

| Area | Why it was kept |
|---|---|
| Webhook state machine (signature → structural validation → atomic acquisition → verification gates → order write) | Correct and fail-closed; extended only with a refund-event branch |
| Capture verification (capture id/order id identity, amount in cents, currency) | Already blocked partial/foreign captures; added only a cancelled/refunded guard |
| Server-side pricing + atomic stock reservation (`stockQuantity >= qty`, `$inc`, oversell floor 0) | Correct; no changes |
| Idempotency key for COD/Card (`userId + idempotencyKey` unique partial index) | Correct; no changes |
| PWA install flow (`beforeinstallprompt`, user-initiated, dismissal/installed state) | Correct; unchanged |
| Room-based Socket.IO delivery | Correct design; only authorization and key derivation fixed |
| CORS allowlist, log redaction, shutdown manager, startup guardrails | Correct; unchanged |

## 3. Confirmed defects and root causes

| ID | Defect | Root cause | Correction |
|---|---|---|---|
| **K-13** | A failed stock restoration was lost permanently | `stockReserved` cleared first; per-product credits best-effort with `catch { log }`; no retry state | Atomic claim now records `inventoryRestoration:'pending'`; per-item `stockRestored` marker set after success; boot + 5-min sweep retries; structured alert |
| **K-14** | Duplicate refunds possible; `PENDING` recorded as refunded | Intent recorded after the gateway call; no separate refund state; refund events ignored | Atomic claim **before** gateway; `refundStatus` (`pending/completed/failed`); 202 for PENDING; indeterminate stays reconcilable; `PAYMENT.CAPTURE.REFUNDED` reconciliation with amount+currency checks |
| **K-15** | Late capture could resurrect a cancelled/refunded order | Capture update filtered only on `paypalOrderId + userId`; wrote `completed` + `Order Placed` unconditionally | Pre-flight `409 ORDER_NOT_PAYABLE`; atomic cancelled/refunded guard `409 CAPTURE_REQUIRES_RECONCILIATION`; capture id stored for refund; ops alert |
| **K-16** | Any authenticated socket could join any order room; shopper updates silently dropped | No ownership check on `join_order_room`; populated `userId` stringified to `[object Object]` | Ownership check + typing allow-list; room key from `_id`/`toHexString()`; two-tab-safe disconnect |
| — | Secret scanner blind spot | All assignment checks skipped in fixtures | Fixtures scanned; only short/obviously synthetic values waived |
| — | Sandbox helper could call live PayPal | Built `LiveEnvironment` when `PAYPAL_ENV=live` | `--create`/`--capture` refuse with exit 2 before any request |
| — | Load results measured the rate limiter and inventory exhaustion | Only 5xx counted; seeded stock 10; limiter 1000/15 min | 4xx + per-scenario success reported; deep stock; limiter raised only on the disposable target; stock-consistency assertion |
| — | Accessibility failures (axe) | Badge colours overridden by daisyUI; `text-yellow-600` ≈3.1:1; a `Contact Support` button whose aria-label omitted its visible text (WCAG 2.5.3); scans ran mid-animation / over not-yet-revealed cards | Explicit badge colours; yellow-800/red-700; aria-label removed (visible text is the name); scans reveal the page, finish animations, then scan |
| — | WebKit mobile overflow / 404 noise | Monitor entry `x:300` counted in scrollWidth; WebKit omits URLs from 404 console messages | Vertical entry animation; 404 URLs captured and attributed |

## 4. Modified files and why

| File | Reason |
|---|---|
| `backend/services/reservationService.js` | Durable restoration state machine, atomic cancel-on-claim, retry sweep + alerts |
| `backend/models/orderModel.js` | `items[].stockRestored`, `inventoryRestoration`, `refundStatus/Attempts/LastError`, sweep index |
| `backend/controllers/orderController.js` | Refund claim/state machine, refund webhook reconciliation, capture guards, shared durable release |
| `backend/services/socketService.js` | Order-room authorization, typing allow-list, safe room key, two-tab disconnect |
| `backend/app.js` | Optional `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` (defaults unchanged) |
| `backend/server.js` | Boot runs full inventory sweep (expiry + owed restorations) |
| `backend/scripts/{paypal-sandbox-check,scan-secrets,load-test,e2e-server,verify-startup}.mjs` | Live-PayPal refusal, fixture-safe scanner, valid load measurement, E2E limits, synthetic fixture value |
| `backend/.env.example` | Documents `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX`; env set verified at 35 |
| Tests (`refundWorkflow`, `reservationExpiry`, `socketRealtime`, `webhookIdempotency`, +2 new specs) | Regression coverage for every correction |
| `frontend/src/components/{ProductItems,PerformanceMonitor,OurPolicy}.tsx` | WCAG contrast fixes; no horizontal-overflow entry animation; label-in-name fix |
| `frontend/e2e/{a11y,ui-audit}.spec.ts` | Settled-state scans; 404 attribution by URL |
| Frontend unit tests (3 files) | Updated to the intentionally improved accessible names (WCAG 2.5.3) |
| `docs/01–09`, `docs/devops/00,07,08`, `AGENTS.md`, `README.md` | As-built contract updates; counts, state machines, runbooks, blocked status |
| `docs/testing/load-results-2026-10-26-post-fix.json` | New load artifact (old artifact retained, marked non-comparable) |

## 5. Regression coverage added/changed

- `refundWorkflow.spec.js` — **15** tests: authz; completed-only; atomic claim under
  concurrency (one gateway call); `PENDING` → 202 and not refunded; timeout →
  reconcilable and retry-blocked; definitive 4xx → `failed` and retryable;
  signed refund webhook completes/fails/mismatches; duplicate webhook does not
  double-credit stock.
- `reservationExpiry.spec.js` — **13** tests: TTL; release once; live/COD/paid
  untouched; late capture after cancellation; **failed credit stays owed and is
  retried**; multi-item at-most-once; deleted product settles; **crash after the
  product credit but before the order marker does not double-credit**; two
  concurrent workers credit once; ledger hidden from the API; capture refused
  pre-flight and across an in-flight cancellation.
- `socketRealtime.spec.js` — **7** tests: real server↔client delivery, token
  refusal, reconnect, populated-user update, **foreign room join refused**,
  two-tab disconnect.
- `webhookIdempotency.spec.js` — event type used for "ignored" updated because
  refunds are now handled; all 9 tests pass.
- `secretScanner.spec.js` — **7** tests; `sandboxScriptSafety.spec.js` — **2**.
- `distributionArchive.spec.js` — **8** tests: path policy (`.env`/keys/logs/build
  dirs), clean source passes, tracked `.env` rejected without printing its value,
  private key rejected, `git archive` ZIP built only after validation, dirty
  tree refused, embedded credential detected.
- `frontend/e2e/a11y.spec.ts` + `ui-audit.spec.ts` — settled-state axe scans,
  404 attribution, mobile overflow measurement.

## 6. Executed gates (this machine: darwin x64, 16 vCPU, Node 24.20.0)

| Gate | Command | Result |
|---|---|---|
| Backend regression | `cd backend && npm run test:security` (identical to `npm test`; final run used `npm test`) | **42 suites / 416 tests PASS** |
| Backend lint | `npm run lint` | PASS |
| Backend syntax | `npm run build` (`node --check`, 100 files) | PASS |
| Backend startup | `npm run verify:startup` | PASS (see §6.1) |
| Backend coverage | `npm run test:coverage` | PASS — 42 suites / 416 tests; **76.87 % statements / 77.81 % lines / 68.88 % branches / 78.57 % functions** (now includes `scripts/scan-secrets.mjs` + `scripts/verify-distribution.mjs`, hence lower than the 41-suite figure) |
| Frontend unit | `npm run test -- --run` | **24 files / 125 tests PASS** |
| Frontend lint / types | `npm run lint` · `npm run type-check` | PASS |
| Frontend build | `npm run build` | PASS (PWA `sw.js` + workbox generated) |
| Admin unit | `npm run test -- --run` | **13 files / 70 tests PASS** |
| Admin lint / types / build | `npm run lint` · `npm run type-check` · `npm run build` | PASS |
| Browser matrix | `cd frontend && npm run test:e2e` | **51/51 PASS** (17 × Chromium/Firefox/WebKit) |
| npm audit (read-only) | each app | backend 0 · admin 0 · frontend 3 moderate (build-time Tailwind/PostCSS), no high/critical |
| Secret scan | `cd backend && npm run security:secrets` | Clean (tree + full history) |
| PayPal sandbox check | `npm run paypal:sandbox -- --check` | Exit 2 — `PAYPAL_WEBHOOK_ID` missing |
| PayPal sandbox create | `npm run paypal:sandbox -- --create` | Sandbox order `7HC18984P46126319` (CREATED); no approval/capture |
| Load / reliability | `npm run load:test` | See §7 |

### 6.1 Startup verification

`verify:startup` spawns the real `server.js` against in-memory MongoDB and
asserts readiness flips to 200, the process exits 0 on SIGTERM, and no canary
secret appears in output. It passed in this run.

## 7. Performance / reliability (new artifact)

`docs/testing/load-results-2026-10-26-post-fix.json` — disposable in-memory
backend on `127.0.0.1:3101`, deep seeded stock, rate limiter raised **only**
there, 15 s per level.

| VUs | Requests | Throughput | p50 | p95 | p99 | 5xx | 4xx | Checkout success |
|---|---|---|---|---|---|---|---|---|
| 1 | 1,415 | 94.3 rps | 6.1 ms | 34.2 ms | 46 ms | 0 % | 0 % | 100 % (122/122) |
| 10 | 2,495 | 166.3 rps | 45.1 ms | 155.1 ms | 206.8 ms | 0 % | 0 % | 100 % (234/234) |
| 50 | 2,749 | 183.3 rps | 211.8 ms | 709 ms | 852.5 ms | 0 % | 0 % | 100 % (287/287) |
| 100 | 2,715 | 181 rps | 423.8 ms | 1,475.8 ms | 2,279.8 ms | 0 % | 0 % | 100 % (278/278) |
| 250 | 2,640 | 176 rps | 714.8 ms | 4,232.7 ms | 16,323 ms | 0 % | 0 % | 100 % (229/229) |

- Stop rule triggered at 250 VU (p95 > 3 s) — expected and documented.
- **Stock consistency:** initial 1,000,000 → final 998,850; 1,150 successful
  orders; expected 998,850 → **consistent**.
- **Recovery:** `/health/ready` avg 1.7 ms, all 200 after load.
- **RSS:** 91–114 MB. **CPU: unavailable on macOS (reported as null, never 0).**
- These are **not** production capacity numbers and are **not comparable** to the
  old artifact (which counted only 5xx and measured limiter responses). Do not
  reuse them as a capacity claim.
- Backend env template verified at **35** variables (the preserved baseline says
  30; the additions are `PAYPAL_PAYEE_EMAIL`, `PAYPAL_RESERVATION_TTL_MS`,
  `RESERVATION_SWEEP_INTERVAL_MS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`).

## 8. PayPal sandbox evidence

> `docs/devops/07` and `docs/devops/08` are preserved Phase 1 records. Their
> status lines are **superseded by this section and §9** — they were not edited.

| Step | Result |
|---|---|
| Environment selection | ✅ `PAYPAL_ENV=sandbox` (`config/paypalEnv.js`) |
| Credentials present | ✅ client id + secret, not placeholders |
| Sandbox order creation | ✅ order `7HC18984P46126319`, status `CREATED` — **no charge** |
| Buyer approval | ⛔ BLOCKED — no sandbox buyer session; order left unapproved |
| Capture + capture id | ⛔ BLOCKED — requires approval |
| `PAYPAL_WEBHOOK_ID` | ⛔ MISSING — `--check` exits 2 |
| Public HTTPS webhook | ⛔ BLOCKED — no public host/tunnel |
| Signed webhook / duplicates / delayed / invalid signature | 🟡 Offline specs only (mocked edge) |

**Conclusion:** real PayPal end-to-end remains **UNVERIFIED**. No capture id,
webhook receipt or provider response was fabricated. The exact owner actions
are: set `PAYPAL_WEBHOOK_ID`, expose the backend on HTTPS, register
`PAYMENT.CAPTURE.COMPLETED` + `PAYMENT.CAPTURE.REFUNDED`, approve with a
sandbox buyer, then run `--capture` and replay the signed events.

## 9. Credential rotation and Git history

- Working tree + **full git history** scanned clean with the hardened scanner.
- `JWT_SECRET` / `ADMIN_PASSWORD`: **VERIFIED ROTATED** (2026-10-24 live check,
  `docs/devops/09`).
- PayPal secret/webhook id, MongoDB, SMTP, Cloudinary: **ROTATION REQUIRED**
  (dashboard owner actions; a clean repo is not a rotation).
- Git-history purge of the canonical repository: **not performed** — requires
  explicit owner approval for a history rewrite/force-push (`docs/devops/07`).

## 10. Refund and inventory consistency assessment

- Refund: `paymentStatus:'refunded'` **only** when `refundStatus:'completed'`.
  PENDING/timeout/5xx stays `pending`, blocks a second automatic refund, and is
  settled by the signed `PAYMENT.CAPTURE.REFUNDED` event or manual
  reconciliation. Concurrent requests produce exactly one gateway refund
  (tested).
- Inventory: every release is an atomic claim + durable obligation. A failed
  product credit remains `reconciliation_required` and is retried at boot and
  every sweep; each item is credited at most once via `items[].stockRestored`.
  Deleted/invalid products are settled, not retried forever.
- Exactly-once: the stock credit and its proof (`restorationCredits` entry) are
  one atomic single-document update on the product, so a crash or a concurrent
  retry can neither lose nor duplicate a credit. `items[].stockRestored` is
  bookkeeping only. No replica set or multi-document transaction is required.
  Growth and pruning guidance: `docs/09` §5.2.
- Late capture after cancellation is refused pre-flight and across the in-flight
  race; money is never taken for an order whose stock was returned.

## 11. Socket.IO evidence

Real server + real `socket.io-client`: shopper and admin receive their events;
anonymous/invalid tokens refused; reconnect re-registers; a populated user
reference now addresses `user_<id>`; a different authenticated shopper **cannot**
join the owner's `order_<id>` room and receives no private event; disconnecting
one of two tabs keeps the user registered; graceful shutdown closes the server.

## 12. Browser, accessibility and PWA results

| Engine | Tests | Result |
|---|---|---|
| Chromium | 17 | ✅ 17/17 |
| Firefox | 17 | ✅ 17/17 |
| WebKit | 17 | ✅ 17/17 |

Covered: signup/login (UI), catalog, product detail, search/filter, cart,
COD and Card checkout against the real backend, order checks, PWA install
button (user-initiated, does not block login), routed pages, 404, mobile
viewport (no horizontal scroll), keyboard navigation, session persistence,
landmarks/alt text/single H1. axe-core: 4 page types × 3 engines, no
critical/serious violations **after** the badge/contrast fixes and
settled-state scanning.

**Not claimed:** full WCAG 2.2 AA conformance. Automated scans cover roughly
half of real accessibility defects; **manual screen-reader testing was not
performed** and is recorded as a gap. PWA offline/update behavior was exercised
by unit tests, not by a browser offline session.

## 13. Remaining production blockers

1. **PayPal sandbox end-to-end is BLOCKED** — needs `PAYPAL_WEBHOOK_ID`, a
   public HTTPS endpoint, and a sandbox buyer approval/capture.
2. **Provider credential rotation is outstanding** — PayPal secret/webhook id,
   MongoDB, SMTP, Cloudinary (owner dashboard actions).
3. **Git-history purge of the canonical repo** — owner approval required;
   rotation must happen regardless.
4. **Manual accessibility verification** (screen reader, zoom/reflow) — not
   executed.
5. **Production capacity is unmeasured** — numbers above are a local,
   disposable-host baseline only.
6. Frontend carries 3 moderate build-time advisories (Tailwind 3/PostCSS);
   upgrade window is a planned task.

> The current list is **§16.9** (it adds the creation-time reservation window
> found in the second pass); this section is the first-pass snapshot.

## 14. Git diff summary and recommended commit message

**39 files staged, uncommitted** (~3,050 insertions, ~280 deletions): 35
modified files, two new test specs (`secretScanner.spec.js`,
`sandboxScriptSafety.spec.js`), this report, and the new load artifact
`docs/testing/load-results-2026-10-26-post-fix.json`. No secrets, no dependency
upgrades, no infrastructure, no history rewrite. Nothing was committed, tagged,
force-pushed or written to a remote.

Recommended commit message:

```
fix(payments,inventory,realtime): durable refund and stock-restoration state
machines, capture-after-cancel guards, private order rooms, and verifiable
quality gates

- refunds: claim intent before the gateway; refundStatus pending/completed/
  failed; signed PAYMENT.CAPTURE.REFUNDED reconciliation (K-14)
- inventory: inventoryRestoration + per-item stockRestored + retry sweep (K-13)
- capture: refuse cancelled/refunded orders pre-flight and atomically (K-15)
- socket: order-room ownership check, populated-user room key (K-16)
- quality: cross-browser E2E fixes, WCAG contrast, load-harness validity,
  secret-scanner fixture hardening, sandbox helper live guard
- docs: as-built contract, runbooks, blocked PayPal/rotation status
```

## 15. Final decision

**CONDITIONAL PASS.**

The engineering gates that can be executed here pass: 416 backend tests, 125
storefront tests, 70 admin tests, 51 cross-browser E2E checks, zero audit
high/critical, clean secret and distribution scans, and a load run with 0
errors and exact stock consistency. Payment capture cannot falsely succeed,
refunds cannot be duplicated or falsely finalized, stock can neither be lost
nor double-credited through restoration (single-document atomic ledger), and
private order events do not cross users.

Production release is **not** approved because real PayPal sandbox behaviour,
provider credential rotation, and the canonical-repo history decision remain
externally blocked. Close those, then this report can be re-issued as PASS.

---

## 16. Second pass (2026-10-26): archive exposure, rotation, PayPal, exactly-once inventory

This pass targeted the four remaining production blockers. It does not change
the decision in §15 except where stated: inventory **restoration** is now
closed (a separate creation-time window was found and is recorded in §16.4.1);
the other three remain external.

### 16.1 Archive credential exposure — DEFECT CONFIRMED, code-side closed

| Item | Finding |
|---|---|
| Root cause | A release ZIP was built from the **working directory**. `.gitignore` only affects Git, not `zip -r`; `backend/.env` (ignored, populated) was therefore included |
| Current worktree | No `.zip`/`.tar` artifacts; tracked set contains only `.env.example` templates; secret scan of tree + history is clean |
| New control | `backend/scripts/verify-distribution.mjs` + `npm run security:distribution` |
| What it rejects | populated `.env` (templates allowed), `*.pem/key/p12/pfx/jks`, SSH private keys, logs, nested archives, build/cache/test dirs, OS junk — and credential-shaped **content** via the hardened scanner |
| How the ZIP is made | `git archive --format=zip --output=… HEAD` **after** validation, and only from a **clean** tree (uncommitted content cannot be released because it would not match what was validated) |
| Output safety | Findings list path + kind only; secret values are never printed (asserted by test) |
| Tests | `distributionArchive.spec.js` — 8 cases (safe tree, tracked `.env`, private key, tracked `node_modules`, clean-archive build, dirty-tree refusal, embedded credential, path policy) |
| Irreversible part | The old ZIP cannot be recalled; its credentials stay **ROTATION REQUIRED** regardless of the new control |

### 16.2 Credential rotation — EXTERNAL ACTION REQUIRED (not claimed complete)

Per-credential classification is in `docs/devops/07` §1 (status table). Summary:
PayPal client secret, PayPal webhook id, MongoDB password, Cloudinary secret and
SMTP password are **ROTATION REQUIRED** (archive-exposed; dashboard owner
actions). `JWT_SECRET` and `ADMIN_PASSWORD` are **VERIFIED ROTATED** on
2026-10-24 — the owner must confirm the distributed ZIP predates that rotation,
otherwise rotate again. `PAYPAL_CLIENT_ID` is **VERIFIED NOT EXPOSED** by design.

Git history in this checkout: working tree and full history scan clean. The
canonical repository's history purge remains an owner decision; rotation is
required regardless, and no history rewrite/force-push was performed.

Client-bundle audit (2026-10-26): `frontend` reads only
`VITE_BACKEND_URL` + `VITE_PAYPAL_CLIENT_ID` (plus Vite's own `DEV`/`PROD`/
`MODE`), `admin` only `VITE_BACKEND_URL`; neither bundle references
`process.env` or any server-secret name (`MONGODB_URI`, `JWT_SECRET`,
`PAYPAL_CLIENT_SECRET`, `CLOUDINARY_SECRET_KEY`, SMTP credentials).

### 16.3 PayPal Sandbox — BLOCKED (unchanged)

- `npm run paypal:sandbox -- --check` → exit 2: `PAYPAL_WEBHOOK_ID` unset.
- `--create` → genuine sandbox order `7HC18984P46126319` (`CREATED`), **no charge**.
- Buyer approval ❌ no sandbox buyer session · Capture ❌ depends on approval ·
  Signed HTTPS webhook ❌ no public endpoint/webhook id · Refund ❌ depends on capture.
- Offline coverage (mocked edge only): idempotency, unmatched capture, mismatch
  gates, refund reconciliation, timeouts, cancellation, expiry races.
- The helper refuses `--create`/`--capture` under `PAYPAL_ENV=live` (exit 2).

No capture id, webhook receipt or provider response was fabricated.

### 16.4 Inventory restoration — now EXACTLY-ONCE (blocker closed)

**Design chosen: durable per-line ledger embedded in the product document**
(Option C), not a multi-document transaction (Option B).

- Each order line has a deterministic credit id: `<orderId>:<itemIndex>`.
- The credit is a single `findOneAndUpdate` on `products`:
  filter `{_id, restorationCredits: {$ne: creditId}}`, update
  `{$inc: {stockQuantity: qty}, $addToSet: {restorationCredits: creditId}, $set: {inStock: true}}`.
- MongoDB guarantees **single-document** atomicity, so the stock change and the
  proof that it happened commit together or not at all. No replica set, no
  transaction, no new collection.
- Retry/concurrent worker with the same id matches nothing; a follow-up
  `exists({_id, restorationCredits: creditId})` distinguishes “already applied”
  from “product deleted”. `items[].stockRestored` is bookkeeping only.
- Why not a transaction: local/test MongoDB is standalone (transactions require
  a replica set), the deployment assumption would silently change, and a
  single-document design already provides the required guarantee.
- Bound/overflow: the increment only returns previously reserved units; stock
  cannot go negative here, and the product schema floor remains 0.
- Growth: one short string per restored line per product; pruning guidance is
  in `docs/09` §5.2 (never prune while an obligation is open). `select: false`
  keeps it out of every product API response (asserted by test).
- Performance: the credit is one indexed single-document write per line on the
  cancel/refund/expiry path (never on the checkout request path). No extra
  round-trip, no transaction, no lock held across documents; the added array
  element is a few dozen bytes per line.
- Legacy caveat: obligations created **before** this ledger (pre-production
  only) have no ledger entry; they must be reconciled manually rather than
  blind-retried. No production data exists yet.

**Proof (real in-memory MongoDB, not mocks of the write):**

| Test | Assertion |
|---|---|
| Crash after credit, before marker | stock credited once; retry completes without a second credit; ledger entry present |
| Two concurrent workers | stock credited exactly once; one ledger entry; status completed |
| Failed credit | obligation stays `reconciliation_required`; retry credits |
| Multi-item, one failure | only the failed item is retried; the successful item is untouched |
| Deleted product | obligation settles; no infinite retry |
| Duplicate sweeps | no further retries once completed |
| API response | `restorationCredits` never exposed |

#### 16.4.1 Residual risk found during this pass — creation-time reservation (CLOSED in §18.4, 2026-10-26)

Classification: **DEFECT CONFIRMED, not fixed in this pass (owner decision
required)**. It is *separate* from the restoration window above, which is
closed.

| Aspect | Finding |
|---|---|
| Path | `orderController.placeOrder` (COD/Card) and `POST /api/orders/paypal/create` both call `reserveStock()` — per-item atomic `$inc: -qty` — **before** `orderModel.save()` |
| Failure mode | If the process dies (or the event loop is killed) after a decrement and before the order insert, the units are gone from `stockQuantity` with **no order document**. No sweep can find them; `releaseStock()` is in-process best-effort and unreachable after a crash. Repeated occurrences silently shrink sellable stock |
| Why it was not changed now | The fix reorders the checkout write path (order draft first, then line-by-line reservation) and adds reservation state/ledger semantics. That is a behaviour change to the money path, outside the four named blockers, and must not be slipped in without owner approval |
| Required remediation | 1) insert the order draft with `stockReserved:false`; 2) decrement each line with a debit marker (`<orderId>:<index>`) added in the **same** product update; 3) after all lines, atomically set `stockReserved:true`; 4) a boot/sweep pass credits back recorded debits of drafts older than a threshold (existing `restorationCredits` ledger makes the credit idempotent) and cancels the draft; 5) delete the draft on a normal insufficient-stock failure (preserves today's "no order created" UX) |
| Test bar for closing it | Fault injection at each step: crash before any decrement, after a partial decrement, after all decrements but before the flag, plus two concurrent workers and a draft from a previous process; assert stock and order state both converge |
| Interim operational mitigation | After an unclean shutdown, reconcile recent orders against stock for checkout traffic around the crash window; there is no automatic detector today |

Impact on the decision: inventory **restoration** is closed; end-to-end
inventory crash safety is **not** claimed.

### 16.5 Gates after the second pass

| Gate | Result |
|---|---|
| Backend `npm test` | **42 suites / 416 tests PASS** |
| Backend lint / syntax | PASS (0 errors; `node --check` over 100 files) |
| Backend coverage | PASS — 76.87 % statements / 77.81 % lines (new scripts included) |
| Backend startup (`verify:startup`) | PASS |
| Frontend unit / lint / types / build | 24 files / 125 tests PASS; PASS |
| Admin unit / lint / types / build | 13 files / 70 tests PASS; PASS |
| Browser matrix | 51/51 PASS (re-executed after the ledger change; `E2E_PORT=3101 E2E_WEB_PORT=5273` because 3001 was occupied) |
| Secret scan (tree + history) | Clean |
| Distribution policy | Clean tracked HEAD set |
| PayPal sandbox | BLOCKED (see §16.3) |

### 16.6 Decision impact

Inventory restoration is no longer a production blocker: stock cannot be lost
**or** double-credited across a crash **once a reservation has been recorded on
an order**. The separately discovered creation-time window (§16.4.1) was **closed
in the fourth pass** — see §18.4 (K-21): order draft first, per-line debit
marker, conditional commit, abandonment sweep. Its second-pass status is
recorded below and is superseded. The overall decision remains
**CONDITIONAL PASS** on the external gates (real PayPal lifecycle, provider
rotations, canonical history decision, manual accessibility, production
capacity), with that one code-side item flagged for the next pass.

### 16.7 Preserved functionality and SEO note

This pass changed only backend inventory/credit internals, one new archive
script, tests and documentation. No storefront/admin component, route, design or
API contract changed; the only schema addition is the internal
`restorationCredits` array (`select:false`), and the existing suites (checkout,
cart, auth, addresses, orders, admin, Socket.IO, PWA, a11y) are the regression
evidence.

**Pre-existing SEO/branding gap (not introduced here, not silently changed):**
`frontend/index.html` still carries the legacy `SKR E-Commerce` title/`og:title`
and an `og:image` pointing at an old Netlify host, and the app ships no
`robots.txt`/`sitemap.xml`. Correcting the canonical metadata needs the real
production domain (for absolute URLs), so it is recorded as an owner action
rather than guessed. No SEO architecture was altered.

### 16.8 Baseline, files changed and suggested commit

**Baseline:** branch `main`, HEAD `6f3c5cb00dca066b4dc1f1ac55d0fef4beeaab9a`
(*test: strengthen pre-DevOps QA and production readiness*, 2026-10-26
12:51 +0530). The second pass is **uncommitted**: 20 modified files + 2 new
files, no tags, no remote, no history rewrite.

| Area | Files |
|---|---|
| Inventory correctness | `backend/services/reservationService.js` (product-side exactly-once ledger), `backend/models/productModel.js` (`restorationCredits`, `select: false`) |
| Tests | `backend/__tests__/reservationExpiry.spec.js` (+3: crash-after-credit, concurrent workers, ledger hidden), `backend/__tests__/distributionArchive.spec.js` (new, 8) |
| Archive control | `backend/scripts/verify-distribution.mjs` (new), `backend/package.json` (`security:distribution`) |
| Contract docs | `docs/01`, `docs/03`, `docs/04`, `docs/06`, `docs/07`, `docs/08`, `docs/09`, `docs/10`, `docs/architecture/CHECKOUT_PAYMENT_FLOW.md`, `docs/architecture/DATABASE_RELATIONSHIPS.md`, `docs/architecture/ARCHITECTURE_AUDIT.md`, `AGENTS.md`, `README.md` |
| Preserved Phase 1 records | `docs/devops/00` (dated addendum §13), `docs/devops/07` (credential status table), `docs/devops/08` (blocked-status table) |

Reused unchanged (no duplicate implementations introduced): the existing
`reservationService` state machine and sweep, `scan-secrets.mjs`'s
`analyzeText()` rule set, `paypal-sandbox-check.mjs`, the refund/capture
guards, and every storefront/admin component.

Suggested commit message for this pass:

```
fix(inventory,security): exactly-once stock restoration ledger and
distribution-archive credential gate

- inventory: credit stock and its proof in one product findOneAndUpdate
  ($inc stockQuantity + $addToSet restorationCredits '<orderId>:<index>',
  filtered by $ne), eliminating the crash window that could double-credit;
  items[].stockRestored is bookkeeping only, ledger is select:false
- tests: crash-after-credit, concurrent-worker and API-hiding cases on real
  in-memory MongoDB; new distributionArchive.spec.js (8 cases)
- security: verify-distribution.mjs rejects .env/keys/logs/build dirs in the
  tracked set, never prints values, and builds ZIPs only via git archive from
  a clean HEAD; wired as npm run security:distribution
- docs: as-built schema/operations contract, credential status, blocked PayPal
  evidence, corrected test/env/syntax counts
```

### 16.9 Remaining blockers and required owner actions

> Superseded by §17.9/§17.10 (third pass) — kept for the second-pass record.

| # | Blocker | Status | Owner action |
|---|---|---|---|
| 1 | Real PayPal lifecycle (create → approve → capture → signed HTTPS webhook → reconcile) | ⛔ BLOCKED | Provide `PAYPAL_WEBHOOK_ID` + a public HTTPS endpoint + a sandbox buyer; execute `docs/devops/08` and record capture/webhook ids there |
| 2 | PayPal client secret / webhook id rotation | ⚠️ ROTATION REQUIRED | PayPal dashboard → Apps & Credentials → new secret; recreate webhook; deploy; revoke old secret |
| 3 | MongoDB password rotation | ⚠️ ROTATION REQUIRED | Atlas → Database Access → reset password → update `MONGODB_URI` → restart |
| 4 | Cloudinary secret rotation | ⚠️ ROTATION REQUIRED | Cloudinary console → API Keys → regenerate → update `CLOUDINARY_SECRET_KEY` |
| 5 | SMTP password rotation | ⚠️ ROTATION REQUIRED | Provider → revoke/reissue app password → update `SMTP_PASS` |
| 6 | `JWT_SECRET` / `ADMIN_PASSWORD` archive-age check | ✅ Rotated 2026-10-24 | Confirm the distributed ZIP postdates that rotation; if not, rotate again (invalidates all sessions) |
| 7 | Canonical Git-history purge | 🟡 DECISION | Approve a `git-filter-repo` rewrite + coordinated force-push, or accept history as-is knowing rotation is what actually protects the credentials |
| 8 | Manual accessibility verification (screen reader, 200 % zoom/reflow) | ❌ NOT EXECUTED | Run the manual checklist; automated axe is not a substitute |
| 9 | Production capacity / load on real infrastructure | ❌ NOT EXECUTED | Re-run `docs/testing/load-results-2026-10-26-post-fix.json` procedure against staging |
| 10 | Canonical SEO metadata + `robots.txt`/`sitemap.xml` | 🟡 OWNER INPUT | Supply the production domain; then set title/`og:*`/canonical/robots (legacy `SKR E-Commerce` strings and the old Netlify `og:image` remain) |
| 11 | Creation-time reservation crash window (§16.4.1): decrement before the order exists → unrecoverable stock loss | ✅ **CLOSED in §18.4 (K-21)** — order draft first + per-line debit marker in the same atomic product update + conditional commit + abandonment sweep; 12 fault-injection cases | No action; keep the draft-first ordering |

No credential was rotated, no history was rewritten and no PayPal capture or
webhook was fabricated in this pass.

**Rollback:** reverting the ledger change is safe for data — `restorationCredits`
entries are ignored by older code, and no order depends on them to be readable.
Reverting the *behaviour* would reopen the double-credit window; if a rollback is
required, stop the reservation sweep first and reconcile
`inventoryRestoration.status` manually before re-enabling it.

---

## 17. Third pass (2026-10-26, evening): credential containment, dangling-object audit, SEO/branding

Triggered by the owner's "credentials first" instruction. Secret values were
never printed, echoed, committed or archived; every verification below reports
only status codes, booleans and lengths.

### 17.1 Value-free exposure assessment

| Finding | Detail |
|---|---|
| `backend/.env` exists, never committed | `git log --all -- backend/.env` is empty in this checkout; file mode tightened to `0600` |
| MongoDB URI — **LIVE, works** | Atlas `mongodb+srv` with embedded credentials; a bare `mongoose.connect` succeeded (pre-rotation baseline) |
| Cloudinary — **LIVE, works** | Admin-API `ping` returned ok with the current values (pre-rotation baseline) |
| `ADMIN_PASSWORD` — **WEAK (9 chars)** | Live-verified working, then rotated (17.2) |
| PayPal sandbox id + secret | Present; secret works (sandbox order creation, no charge); **older** secret value found in a dangling blob (17.3) |
| `JWT_SECRET` | 128 chars; rotated again in 17.2 (archive-age question closed by re-rotating) |
| SMTP_* / `PAYPAL_WEBHOOK_ID` / optionals | SMTP absent (nothing to rotate here); webhook id still missing (PayPal blocker); optional vars absent |
| Unknown key `NPM_CONFIG_PRODUCTION` in `.env` | Not read by any code; harmless; left untouched |
| `frontend/.env`, `admin/.env` | Did not exist; templates (incl. two old `.zwork` artifact snapshots) verified placeholder-safe by the project scanner (0 findings) |
| Archives | No `.zip`/`.tar`/`.tgz`/`.7z` anywhere in the workspace |

### 17.2 Local credential rotation — EXECUTED AND VERIFIED

`JWT_SECRET` (fresh 128-hex) and `ADMIN_PASSWORD` (generated 20-char, replacing
the weak 9-char value) were rewritten atomically; all other keys preserved
byte-identical. Verification against a real server boot (status codes only):

| Step | Expect | Actual |
|---|---|---|
| A0 baseline config read | values in memory only | admin-password len 9, jwt len 128 |
| A1 old-credential admin login | 200 | **200** (token captured in memory) |
| A2 wrong-password login | 401 | **401** |
| B1 rewrite | exactly one line each | jwt 128 (new), admin 20; other 13 keys preserved: **yes** |
| C1 NEW password login | 200 | **200** |
| C2 OLD password login | 401 | **401** |
| C3 pre-rotation JWT on `/api/orders/all` | 401 | **401** |
| C4 NEW JWT on `/api/orders/all` | 200 | **200** |
| C5 `/health/ready` after rotation | 200 | **200** |

**RESULT: ROTATION VERIFIED.** All existing sessions are invalidated by design.
The new admin password lives only in `backend/.env` — read it there, never paste
it into chat, tickets or docs. **Any backend process started before this
rotation still holds the old values in memory — restart it.**

### 17.3 Dangling-object audit (new control)

`npm run security:secrets -- --history` walks refs and cannot see unreachable
objects. A non-destructive `git fsck --unreachable --no-reflogs` + blob scan
found **31 dangling blobs, 2 with credential assignments**:

- Blob `e8f6c66d…` held the then-**live** JWT secret, admin password, MongoDB
  Atlas URI and Cloudinary secret (value-equality checked against `.env` —
  booleans only; PayPal's value there was older).
- After 17.2, its jwt/admin/paypal entries are dead values; **MongoDB and
  Cloudinary remain live in that blob** until the owner rotates them at the
  providers.
- Exposure scope is local disk only: dangling objects are never pushed, cloned
  or included in `git archive` ZIPs. Classification: **DEFECT CONFIRMED** →
  contained (dead values) except the two provider credentials; physical purge
  is an owner action (`git reflog expire --expire=now --all && git gc
  --prune=now`) — irreversible, not a history rewrite, deliberately not run
  automatically. Procedure: `docs/devops/07` (dangling-object section).
- **Agent checkpoint refs classified (2026-10-26, whole-repo scan):** this
  checkout also carries `refs/agents/a3b39132…/checkpoints/turn/0–3`. Their
  snapshots contain ONLY synthetic values — the startup verifier's `verify-*`
  boot string and an **expired** fabricated mock JWT (payload `id` = the
  textbook example ObjectId, `exp` = 2024-01, decoded to confirm). The scanner
  now waives provably-expired JWTs by rule (fail-closed on undecodable), and
  the mock token is runtime-fabricated on main so future checkpoints stay
  clean. No live credential hides in any ref of this checkout.

### 17.11 Template-file incident (caught and contained the same hour)

At ~16:37 the freshly-issued PayPal client id **and secret** were pasted into
the TRACKED templates `frontend/.env.example` and `frontend/env.example`. The
then-`backend/`-scoped secret gate stayed green (see 17.12); a manual value-free
audit caught it. Containment: both templates restored (`.env.example` from
HEAD; `env.example` PayPal block back to placeholders, branding edits kept);
verified **never staged and never committed** (`git diff --cached` empty,
`git log -S VITE_PAYPAL_CLIENT_SECRET` empty) — exposure never left this
machine. The id (public-by-design) lives in `backend/.env` + git-ignored
`frontend/.env`; the secret lives only in `backend/.env`. Rule recorded in
`docs/devops/07` (template-file rule) and AGENTS trap 23.

### 17.12 Control defect: security gates were cwd-scoped to `backend/` (DEFECT CONFIRMED → CLOSED)

`git ls-files`, `git log` and `git archive` are **cwd-scoped**. Both security
scripts ran from `backend/` (npm), so:

- the secret scanner + history scan covered **106 of 482** tracked files —
  `frontend/`, `admin/`, `docs/` and root scripts were never scanned;
- the distribution gate validated backend-only content while `git archive`
  built from a subdirectory produces a backend-only ZIP — consistent, but a
  "release" silently omitted half the app, and a root-level archive would have
  shipped unvalidated content.

**Fix:** both scripts anchor at `git rev-parse --show-toplevel`; the history
scanner gained an expiry-aware jwt rule (provably-expired tokens can never
authenticate; undecodable fails closed); historical pattern findings now name
the file. **Locked by 6 new spec cases** (secretScanner: expired-waived /
future-exp-flagged / undecodable-fail-closed / `process.env` reference
rejected; distributionArchive: whole-repo scan from a subdirectory cwd,
whole-repo archive from a subdirectory cwd). Gate totals changed: 106 → **482**
validated files.

### 17.4 SEO / branding fixes (CODE COMPLETE — domain-dependent items deferred)

| File | Change |
|---|---|
| `frontend/index.html` | Title/description/keywords/author/`apple-mobile-web-app-title`/`og:*`/`twitter:*` are NovaCart-branded; retired `skr-e-commerce.netlify.app` `og:url` and stale Netlify `og:image`/`twitter:image` **removed** (wrong values are worse than absent); `twitter:card` downgraded to `summary` until a real image URL exists; an HTML comment lists the exact tags to restore once the production domain is final |
| `frontend/public/manifest.json` + `frontend/vite.config.ts` | PWA name/short_name/description and screenshot labels NovaCart-branded (install prompts no longer show legacy branding) |
| `frontend/public/robots.txt` | **NEW** — allow-all, Sitemap line commented pending the domain |

Deferred pending owner input (the production domain): `<link rel=canonical>`,
`og:url`, `og:image`, `twitter:image`, `sitemap.xml`. No test asserted the old
branding (grep-verified), and the frontend gates were re-run green. Pre-existing
observation (unchanged): the manifest references `/screenshot-wide.png` and
`/screenshot-narrow.png`, which do not exist in `frontend/public/`.

### 17.5 `frontend/.env` created (local dev enabler)

Did not exist — so the storefront rendered the "PayPal payments are
unavailable" state locally (the K-2 no-fallback behaviour). Created
(git-ignored, mode `0600`) with `VITE_BACKEND_URL=http://localhost:3001` and
`VITE_PAYPAL_CLIENT_ID` copied from `backend/.env` — the client id is
public-by-design and ships in every build; the secret stays server-side. This
is what lets the owner actually perform the sandbox buyer-approval step.

### 17.6 Gates after this pass

| Gate | Result |
|---|---|
| Backend `npm run test:security` (post-rotation) | **42 suites / 416 tests PASS** |
| Backend `verify:startup` (new credentials) | PASS |
| Frontend lint / type-check / tests / build | PASS — 24 files / 125 tests; PWA build precaches `robots.txt` |
| Admin suite | 13 files / 70 tests PASS |
| Secret scan (tree + history) / distribution policy | Clean / Clean (106 tracked files) |
| Local load test (post-ledger change) | **PASS** — 0 % errors at every level; stock consistency `true`; recovery all-200 (17.7) |
| Browser E2E matrix (post-SEO change) | see 17.8 |

### 17.7 Local load test after the exactly-once ledger change

Artifact: `docs/testing/load-results-2026-10-26-third-pass.json` (same harness,
1 → 10 → 50 → 100 → 250 VU × 15 s, disposable in-memory backend, deep stock):

| VU | Requests | rps | p95 | err | 4xx |
|---|---|---|---|---|---|
| 1 | 3,542 | 236.1 | 14 ms | 0 % | 0 % |
| 10 | 6,746 | 449.7 | 71.7 ms | 0 % | 0 % |
| 50 | 6,334 | 422.3 | 317 ms | 0 % | 0 % |
| 100 | 5,697 | 379.8 | 652.7 ms | 0 % | 0 % |
| 250 | 5,604 | 373.6 | 1,705.9 ms | 0 % | 0 % |

`stock_consistency.consistent: true` (1,000,000 initial units) — the exactly-once
restoration guarantee holds under the full level sweep. Post-load recovery:
`/health/ready` all-200. Cross-run comparison with the post-fix artifact is
indicative only (machine load differs); this run recorded a lower p95 at every
level. Staging capacity remains an owner action (docs/07 §8).

### 17.8 Browser E2E matrix after the SEO change

PENDING.

### 17.9 Task status (owner-requested categories)

| Task | Status |
|---|---|
| JWT + admin credential rotation | **VERIFIED COMPLETE** (local scope; live-verified) |
| MongoDB / Cloudinary / PayPal-secret rotation | **OWNER ACTION REQUIRED** — official-dashboard steps + verification commands in `docs/devops/07` |
| Dangling-blob purge | **OWNER ACTION REQUIRED** (after the rotations; commands in `docs/devops/07`) |
| Git history (refs) | **VERIFIED COMPLETE** — clean here; canonical-repo purge remains an owner decision |
| PayPal sandbox lifecycle | **BLOCKED** — needs `PAYPAL_WEBHOOK_ID`, a public HTTPS host and a sandbox buyer (`docs/devops/08`); `frontend/.env` now enables the buttons |
| Accessibility — automated | **VERIFIED COMPLETE** (axe × 3 engines, part of the 51 E2E checks) |
| Accessibility — manual | **OWNER ACTION REQUIRED** — per-screen checklist: `docs/07` §7 |
| Performance — local | **VERIFIED COMPLETE** (17.7 artifact) |
| Performance — staging capacity | **OWNER ACTION REQUIRED** — plan: `docs/07` §8 |
| SEO | **CODE COMPLETE — EXTERNAL VERIFICATION PENDING** (domain-dependent tags + sitemap) |

### 17.10 Production-blocker checklist

**Before starting DevOps:** ① rotate MongoDB + Cloudinary (and the PayPal
secret for hygiene) and verify with the runbook commands; ② dangling-blob
purge; ③ canonical-repo history decision; ④ manual a11y checklist (docs/07 §7);
⑤ staging capacity run (docs/07 §8); ⑥ SEO domain tags + `sitemap.xml`.

**Before live deployment:** ⑦ full sandbox lifecycle incl. signed webhook +
refund event (`docs/devops/08`); ⑧ `PAYPAL_ENV=live` with freshly created LIVE
credentials; ⑨ deploy from the **rotated** JWT/admin values — never the
pre-rotation ones; ⑩ SMTP (fresh app-password) if email is in scope.

---

## 18. Fourth pass (2026-10-26, late): dangling-object verification and the last code-side blocker

Scope: finish the dangling-blob verification and every post-rotation check, close
the remaining code-side inventory window, and fix the defects found while
auditing metadata. No credential value was printed, no test was weakened, no Git
history was rewritten, and nothing was committed.

Rules held throughout: evidence only (status codes, booleans, lengths), provider
claims only from a provider round-trip, and no production-readiness claim.

### 18.1 Dangling Git objects — re-audited, now gated

Non-destructive `git fsck --unreachable --no-reflogs` on this checkout:
**31 unreachable blobs, 1 carrying credential assignments** (the second blob
recorded in §17.3 no longer exists in this checkout; the audit is re-runnable and
reports what is there now).

Value-free comparison with the current `backend/.env` (the script never prints a
value, only `KEY[length]:STATE`):

| State | Keys in blob `e8f6c66d` (860 B) |
|---|---|
| **LIVE** — identical to the configured value | `MONGODB_URI`, `CLOUDINARY_SECRET_KEY` |
| **STALE** — differs (already rotated) | `JWT_SECRET`, `ADMIN_PASSWORD`, `PAYPAL_CLIENT_SECRET` |
| Identifiers (public by design / not secrets) | `PAYPAL_CLIENT_ID`, `CLOUDINARY_API_KEY`, `CLOUDINARY_NAME`, `ADMIN_EMAIL` |

**New control:** `backend/scripts/audit-dangling-blobs.mjs` (`npm run
security:dangling`) — read-only, exits **1** while any unreachable object still
holds a current secret value, and **fails closed** when no `.env` baseline is
available. Locked by `danglingBlobAudit.spec.js` (7 cases). Purge
(`git reflog expire --expire=now --all && git gc --prune=now`) remains
owner-run and was **not** executed.

### 18.2 Old credentials — functional proof, not a file diff

`backend/scripts/verify-old-credentials.mjs` boots the real app against an
in-memory MongoDB with the current configuration and presents the exposed
values. Status codes only:

| Check | Result |
|---|---|
| Admin login with the **exposed** password | **401** |
| Token signed with the **exposed** `JWT_SECRET` → `GET /api/orders/all` | **401** |
| Admin login with the **current** password (control) | **200** → admin route **200** |
| Token signed with the **current** secret (control) | **200** |

The control rows matter: without them a 401 could just mean the route is broken.

**Operational defect found here (and fixed):** the backend process listening on
`:3001` had started at **13:46**, before the 16:52 rotation, so it still held the
old values in memory — the **old** admin password returned **200** and the **new**
one **401** against that process. It was stopped and restarted from the rotated
`.env`; the storefront dev server was restarted too (its `.env` was created at
16:55, after the Vite process started). Post-restart: old → **401**, new → **200**,
`/health/ready` → **200**. A rotation is not in effect until every process that
read the old environment has been restarted.

**Related correction:** `ADMIN_PASSWORD` alone does not revoke admin tokens —
`authAdmin` verifies the JWT signature and trusts `type/role`; it never compares
the password (the payload does not contain it). `JWT_SECRET` rotation is what
invalidates outstanding tokens. Recorded as AGENTS trap 25 and corrected in
`docs/devops/07` §2.4.

### 18.3 Every exposed credential, independently (provider round-trip)

`backend/scripts/verify-credential-rotation.mjs` (`npm run security:rotation --
--exposed-blob <sha>`) asks each provider two questions: does the current
credential work, and does the exposed copy still work?

| Provider / credential | Current | Exposed copy | Status |
|---|---|---|---|
| MongoDB (`MONGODB_URI`) | ping **ok** | **identical to current, ping ok** | ❌ **NOT ROTATED — OWNER ACTION** |
| Cloudinary (`CLOUDINARY_SECRET_KEY`) | ping **ok** | **identical to current, ping ok** | ❌ **NOT ROTATED — OWNER ACTION** |
| PayPal client secret | OAuth token **200** | OAuth token **401** | exposed copy **REVOKED**; rotate the current secret anyway — it was pasted into tracked templates (§17.11) |
| PayPal webhook id | **absent** | — | ⛔ **BLOCKED** (no webhook exists; every webhook fails closed) |
| JWT secret / admin password | works | **401** | ✅ **VERIFIED ROTATED** |
| SMTP password | **absent** | absent | nothing to rotate on this machine |
| PayPal client id | works | public by design | not a secret |

Distinguishing the two PayPal facts matters: the *value found in the dangling
blob* is dead, but the *currently configured* PayPal sandbox secret is the one
that was pasted into a tracked template earlier the same day — so provider
rotation is still required. Only MongoDB and Cloudinary are confirmed-live
exposures right now.

### 18.4 K-21 — creation-time reservation is now crash-safe (code-side blocker closed)

The defect recorded in §16.4.1: `placeOrder` and `POST /api/orders/paypal/create`
decremented products **before** inserting the order, so a process death in that
gap destroyed units with nothing to reconcile. Implemented exactly as the
approved plan, reusing the existing exactly-once ledger pattern:

| Step | Write |
|---|---|
| 1. Draft | order inserted with `stockReserved:false`, `stockReservation:{status:'pending'}` — the id now exists before any stock moves |
| 2. Debit per line | one `findOneAndUpdate` per line: filter `stockQuantity >= qty` **and** `reservationDebits: {$ne: '<orderId>:<index>'}`, update `$inc stockQuantity:-qty` + `$addToSet reservationDebits` — stock change and proof commit together |
| 3. Commit | atomic `findOneAndUpdate` → `stockReserved:true`, `stockReservation.status:'reserved'`, `completedAt`; returns `null` if the draft was already released |
| 4. Failure | marker-guarded per-line credit (`reservationDebits: debitId` in the filter, `+$pull`), then the draft is deleted — or kept `failed` and retried if a credit failed |
| 5. Sweep | `releaseAbandonedReservations()` runs in the existing boot/5-minute sweep: drafts older than `ABANDONED_RESERVATION_MS` (2 min) are credited exactly once and removed |

Why this is exactly-once: the debit marker and the restoration credit use the
**same** id (`<orderId>:<index>`), and both the credit and its
`restorationCredits` proof are one single-document update. A retry, a racing
sweep, or the cancel/refund path therefore cannot move stock twice. No replica
set or multi-document transaction is required. `reservationDebits` is
`select:false` (asserted absent from the product API).

**Tests — `reservationExpiry.spec.js` grew from 13 to 25 cases (12 new):** grace
window respected; crash before any debit; crash after a partial debit (only the
debited line is credited); crash after all debits before the commit; committed
holds never released; two racing sweeps credit once; failed credit keeps the
draft and retries; debit ledger hidden from the product API; a real checkout
commits and records its marker; an unreservable checkout leaves no order and no
stock change; releasing the same debit twice credits once.

**Explicitly not claimed:** the sweep's 2-minute grace window means a draft that
is *still being reserved* by a live request is never touched; a draft that
commits after being swept cannot happen because the commit is conditional
(`status:'pending'`) and the request returns `409 ORDER_RESERVATION_LOST`
instead of reporting a placed order.

### 18.5 Other confirmed defects fixed in this pass

| Defect | Fix |
|---|---|
| `manifest.json` referenced `/screenshot-wide.png`, `/screenshot-narrow.png`, `/apple-touch-icon.png` — none existed (404s on install) | missing entries removed; every remaining icon verified present; `apple-touch-icon` now points at the existing 192 px PNG |
| `index.html` used Vite's default `/vite.svg` as the primary icon | real favicons (`/favicon.ico`, `/favicon-32x32.svg`), existing PNG sizes kept |
| Storefront footer and About page still said **“Apple Store”** (legacy brand, AGENTS §5.1) | “NovaCart” |
| `AGENTS.md` documents `cd backend && npm run dev`, but the script did not exist | `dev` alias added (`node --watch server.js`), same implementation as `server` |
| Admin token verification did not pin the algorithm (S7) | `jwt.verify(..., { algorithms: ['HS256'] })` in `authUser`/`authAdmin`; auth suites re-run green |
| E2E signup flow raced the login card's entry animation — a click computed mid-transition was lost (Firefox flake, 90 s timeout) | shared `e2e/helpers.ts` waits for a stable box, then asserts the Sign Up form within 10 s; used by all three signup sites |

Observation (not fixed, not a blocker): the secret scanner walks `git ls-files`,
so a brand-new **untracked** file is not scanned until it is staged; the
distribution gate is unaffected (it builds from `HEAD`).

### 18.6 Gates executed in this pass

Every row is a command that was actually run on this machine (darwin x64, 16
vCPU, Node 24), with its real exit code. Numbers are from the final run.

| Gate | Command | Result |
|---|---|---|
| Backend regression | `cd backend && npm run test:security` | **43 suites / 441 tests PASS**, exit 0 |
| Backend lint | `npm run lint` | PASS, exit 0 |
| Backend syntax | `npm run build` (`node --check`) | PASS — 104 files |
| Backend startup | `npm run verify:startup` | PASS — ready 200, default DB `e-commerce`, SIGTERM exit 0, no credential in the log |
| Frontend unit | `npm run test -- --run` | **24 files / 125 tests PASS** |
| Frontend lint / types / build | `npm run lint` · `npm run type-check` · `npm run build` | PASS — PWA build, 103 precache entries |
| Admin unit / lint / types / build | `npm run test -- --run` and the three gates | **13 files / 70 tests PASS**; PASS |
| Browser matrix | `E2E_PORT=3101 E2E_WEB_PORT=5273 npm run test:e2e` | **51/51 PASS** (17 × Chromium/Firefox/WebKit, 8.9 min) |
| Secret scan | `npm run security:secrets` (tree + history) | Clean — 482 tracked files |
| Distribution policy | `npm run security:distribution` | Clean — 482 tracked files |
| **Dangling objects** | `npm run security:dangling` | **exit 1** — `MONGODB_URI` + `CLOUDINARY_SECRET_KEY` are still the configured values inside unreachable blob `e8f6c66d` |
| Rotation verification | `npm run security:rotation -- --exposed-blob e8f6c66d` | **exit 1** — the same two providers still accept the exposed value |
| Old-credential negative test | `npm run verify:old-credentials -- --exposed-blob e8f6c66d` | **exit 0** — old password 401, old-secret token 401, current pair 200/200 |
| PayPal sandbox config | `npm run paypal:sandbox -- --check` | **exit 2** — `PAYPAL_WEBHOOK_ID` missing |
| Load / inventory consistency | `LOAD_TEST_OUT=docs/testing/load-results-2026-10-26-fourth-pass.json npm run load:test` | exit 0 — 0 % errors at 1/10/50/100/250 VU; **stock_consistency.consistent = true** (1,000,000 → 998,697 = expected); recovery all-200 |

Flake note: one full-suite execution returned a single `401` in
`webhookIdempotency.spec.js` (“re-processes LEGACY records”). It did not
reproduce in isolation, in a paired run with the neighbouring webhook spec, or in
the final full run; the assertion now throws with the response body so a
recurrence is diagnosable. Recorded rather than hidden.

### 18.7 Gate status

**Security gates**

| Gate | Status | Evidence / blocker |
|---|---|---|
| Secret scan — tracked tree + full history | **PASS** | 482 files, zero findings |
| Distribution archive policy | **PASS** | 482 files validated; ZIP only via `git archive` from a clean HEAD |
| JWT + admin credential rotation | **PASS** | old password 401, old-secret token 401, current pair 200; stale process found and restarted |
| Admin token verification hardening | **PASS** | `algorithms: ['HS256']` pinned; auth suites 60 tests green |
| **Unreachable git objects** | **FAIL** | blob `e8f6c66d` still yields the **current** MongoDB URI and Cloudinary secret → rotate both, then purge |
| **MongoDB credential rotation** | **FAIL** | exposed value == configured value, `ping ok` today |
| **Cloudinary credential rotation** | **FAIL** | exposed value == configured value, `ping ok` today |
| PayPal secret rotation | **BLOCKED** | exposed (dangling) value is **revoked** (OAuth 401); the *current* secret still needs rotation because it was pasted into tracked templates — owner dashboard action |
| SMTP credential rotation | **N/A** | no SMTP credential on this machine; rotate at the provider only if the old ZIP contained one |
| Git-history rewrite (canonical repo) | **BLOCKED — owner decision** | not required to stop the exposure (rotation does that); no rewrite/force-push performed |

**Payment gates**

| Gate | Status | Evidence / blocker |
|---|---|---|
| Webhook state machine (signature → structure → atomic claim → gates → write) | **PASS** | `paypalWebhook` 6, `webhookIdempotency` 9, `webhookUnmatchedCapture` 8, `captureEndpointVerification` 4 — all green |
| Capture verification (id/amount/currency, cancelled-order guard) | **PASS** | `captureEndpointVerification` + `reservationExpiry` late-capture cases |
| Refund state machine (`refundStatus`, 202, reconciliation, no double refund) | **PASS** | `refundWorkflow` 15 cases |
| Inventory: creation + restoration exactly-once, over/under-sell | **PASS** | `reservationExpiry` 25, `inventoryPricingIntegrity`, `concurrencyRaceConditions`, load stock consistency `true` |
| **Real PayPal sandbox lifecycle (create → approve → capture → signed HTTPS webhook → reconcile)** | **BLOCKED** | no `PAYPAL_WEBHOOK_ID`, no public HTTPS endpoint, no sandbox buyer approval; `--check` exits 2 |
| **Live PayPal credentials** | **BLOCKED** | `PAYPAL_ENV=live` requires freshly created LIVE credentials and a live webhook id |

No payment gate is marked PASS on mock evidence alone: the PASS rows are the
code-level state machines (proved by real in-memory MongoDB + a stubbed network
edge only), and the external lifecycle stays BLOCKED.

### 18.8 Exact remaining actions (owner)

1. **Rotate the MongoDB password** — Atlas → Database Access → edit the app user
   → new password → update `MONGODB_URI` in `backend/.env` → restart every
   process → verify:
   `cd backend && npm run security:rotation -- --exposed-blob e8f6c66d`
   (expect `MONGODB_URI ... REVOKED`, exit 0 for that provider).
2. **Rotate the Cloudinary API secret** — Cloudinary console → Settings → API
   Keys → regenerate → update `CLOUDINARY_SECRET_KEY` → same verification
   command (expect `REVOKED`).
3. **Rotate the PayPal sandbox secret** — Developer Dashboard → Apps &
   Credentials → Sandbox → generate new secret → update
   `PAYPAL_CLIENT_SECRET` → `npm run paypal:sandbox -- --check` must no longer
   report the secret.
4. **Create the sandbox webhook** and set `PAYPAL_WEBHOOK_ID` (subscribe to
   `PAYMENT.CAPTURE.COMPLETED` + `PAYMENT.CAPTURE.REFUNDED`) — `--check` must
   exit 0.
5. **Expose the backend over HTTPS** (sandbox tunnel or staging host), then run
   the real lifecycle: `npm run paypal:sandbox -- --create`, approve as a
   sandbox buyer, `--capture`, replay a signed webhook, confirm
   `paymentStatus:'completed'` from the **webhook** (docs/devops/08).
6. **Purge the dangling objects** once steps 1–3 report `REVOKED`:
   `git reflog expire --expire=now --all && git gc --prune=now`, then
   `npm run security:dangling` must exit 0.
7. **Decide on the canonical-repo history** (rewrite + force-push, or accept it).
8. **Manual accessibility + staging capacity + domain-dependent SEO** remain from
   §17.9 (unchanged by this pass).

Delete the old distributed ZIP if it still exists anywhere; rotation, not
deletion, is what removes the exposure.

### 18.9 Files changed in this pass

| Area | Files |
|---|---|
| Inventory (K-21) | `backend/controllers/orderController.js`, `backend/services/reservationService.js`, `backend/models/{orderModel,productModel}.js` |
| Auth hardening | `backend/middleware/auth.js` (HS256 pinning) |
| New security tooling | `backend/scripts/audit-dangling-blobs.mjs`, `verify-credential-rotation.mjs`, `verify-old-credentials.mjs`; `backend/package.json` scripts (`security:dangling`, `security:rotation`, `verify:old-credentials`, `dev`) |
| Tests | `backend/__tests__/reservationExpiry.spec.js` (+12), `danglingBlobAudit.spec.js` (new, 7), `webhookIdempotency.spec.js` (diagnostic on the legacy case) |
| Storefront | `frontend/index.html`, `frontend/public/manifest.json`, `frontend/src/components/Footer.tsx`, `frontend/src/pages/About.tsx` |
| E2E | `frontend/e2e/helpers.ts` (new), `checkout.spec.ts`, `ui-audit.spec.ts` |
| Contract docs | `AGENTS.md`, `README.md`, `docs/01`, `docs/03`, `docs/04`, `docs/07`, `docs/08`, `docs/09`, `docs/10`, `docs/devops/07` |

Reused rather than rebuilt: the existing sweep/ledger state machine
(`reservationService`), the single secret-pattern set (`scan-secrets.mjs`), the
in-memory test harness (`__tests__/helpers.mjs`), the PayPal sandbox helper, and
every storefront/admin component (only text and icon references changed).

**Decision unchanged: CONDITIONAL PASS.** The code-side inventory blocker is now
closed and every executable gate is green, but production release still depends
on two provider rotations (MongoDB, Cloudinary), the PayPal sandbox lifecycle,
and the dangling-object purge — all owner actions with the exact commands above.
