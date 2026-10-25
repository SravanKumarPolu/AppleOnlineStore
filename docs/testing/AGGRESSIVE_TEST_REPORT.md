# AGGRESSIVE_TEST_REPORT — NovaCart Adversarial, Attack-Mode & Race-Condition Testing

**Date:** 2026-10-25 · **Method:** safe, non-destructive attack simulations against isolated in-memory instances. Every probe below was actually executed and passed at final gate; where a probe *found* a defect pre-fix, the defect, its fix, and its locking test are named. No assertion was weakened to obtain a pass.

---

## 1. Attack surface & executed attack suites (68 adversarial tests, all PASS)

### 1.1 Input-validation attacks — `adversarialInputValidation` (19) ✅
Malformed JSON → 400 not 500 · null/undefined bodies · `items` as object/string/number · empty-cart checkout · **100 KB item name** (no hang) · unicode/control characters in every string field · invalid ObjectIds (product/category) · regex metacharacters in search (ReDoS probe) · string `page` / huge `limit` capped not fatal · garbage quantity / non-string color · **mass-assignment probe (unknown registration fields ignored)** · unsupported HTTP methods · **HTTP parameter pollution (duplicate fields)** · **`__proto__`/`constructor` keys rejected (prototype-pollution guard)** · cart update with `__proto__` payload leaves `Object.prototype` clean.

### 1.2 Authentication attacks — `authenticationAttacks` (18) ✅
Garbage token 401 · valid-structure/wrong-secret 401 · expired 401 · tampered payload (sig mismatch) 401 · **`alg:none` 401** · non-existent user 401 · deactivated user 401 · missing token 401 · **claim injection (`role` field in user token ignored — no self-promotion)** · admin token unforgeable without secret · shopper cannot use admin login · wrong admin password 401 · admin endpoints 403 for user tokens (control test: genuine admin still passes) · login/reset do not reveal account existence · 429 under sustained pressure (limiter engages) · documented-risk regression guard: password reset does not invalidate existing tokens (known, pinned).

### 1.3 Authorization / IDOR attacks — `authorizationIdorAttacks` (13) ✅
Orders list returns caller's orders only · **body-supplied `userId` cannot widen any query** · cart read/write owner-scoped · address book owner-scoped · profile updates cannot retarget · shopper cannot change order status (even own) · cannot delete products · cannot mutate categories · cannot read/purge analytics · **cannot self-approve refunds** · cannot reach debug endpoints · admin tokens cannot act as shoppers on cart/order endpoints.

### 1.4 Injection & web security — `injectionWebSecurity` (16) ✅
NoSQL: `$ne`/`$gt` operator objects rejected at login · `$regex` objects rejected · `$where`-style payload rejected as invalid id · category regex-force-match blocked · XSS: script payloads never execute server-side, stored as text, served as JSON (no HTML reflection) · **multer rejects non-image content types + >5 MB files** · **no static file serving mounted (uploads dir unreachable)** · helmet headers present · CORS rejects unlisted origins, allows listed with credentials · **password hashes never serialized** · health/profile leak no secrets/tokens · auth via custom header — **cross-site form posts cannot authenticate (CSRF-shape defense)**.

### 1.5 Business-logic abuse — `businessLogicCartCheckout` (15) ✅
Duplicate cart adds aggregate · colors tracked independently · quantity 0 / negative → clean removal · last-color removal removes product · cart persists server-side · sync-local accepts guest carts, survives absurd quantities without checkout-math corruption · missing shipping → rejected · **deleted/phantom product orders rejected 400 (pre-fix: 200 with phantom order — fixed with locking test)** · payment-method case sensitivity ("cod"/"paypal" → 400, not 500).

## 2. The money-path invariants under attack (the engagement's critical requirements)

### 2.1 INV-1 — one payment can never double-fulfill — `concurrencyRaceConditions` R-1 (7) ✅

Executed with **real concurrent HTTP traffic** (2/10/50/100 in-flight requests) against the real app + in-memory MongoDB:

| Attack | Result |
|---|---|
| **10 simultaneous identical webhook deliveries** | Exactly **ONE** fulfillment, no duplicate processing |
| **100 simultaneous identical webhook deliveries** | Still exactly **ONE** fulfillment |
| Replay of a completed event after success | Acknowledged, zero side effects |
| Replay after refund | **Payment cannot flip a refunded order back to completed** |
| **Simultaneous capture endpoint + webhook for the same order** | Single completed payment, no double fulfillment |

Supporting state-machine proof (`webhookIdempotency`, 9): interrupted processing is re-acquired and completed (never falsely acknowledged — the failure mode that silently eats PayPal retries), lock windows respected, failures marked for redelivery, legacy records recovered.

### 2.2 INV-2/INV-3 — stock can never oversell; cancels restore exactly once — `inventoryPricingIntegrity` I-1…I-4 (10) ✅

| Attack/assertion | Result |
|---|---|
| Order placement **decrements** stock for real products (I-1) | ✅ (pre-fix: stock never touched — K-5, fixed 2026-10-25) |
| **Concurrent orders racing for the last units never oversell — stock floor = 0** (I-2) | ✅ atomic `$gte` guard + `$inc` reservation |
| Quantity above stock → blocked (single request) · stock 0 → blocked | ✅ |
| Admin cancel **restores** stock (I-3) | ✅ |
| DB failure mid-order **releases** the reservation (I-4) | ✅ |

### 2.3 INV-4 — totals from trusted prices only — P-1/P-2 (same suite) ✅

**Tampered (discounted) unit price rejected — the DB price is used** · negative prices rejected pre-write · zero-priced real-product items rejected · NaN/Infinity/string prices rejected · inflated/non-integer quantities rejected. (Pre-fix: the controller trusted `items[].price` verbatim — fixed 2026-10-25 with locking tests.)

### 2.4 Other races — R-2/R-3 ✅
50 interleaved cart add/updates → parseable cart, no crash, no corruption · 10 concurrent admin status updates → consistent final state (one of the requested statuses, never mixed).

## 3. Honest findings from attack mode

**AF-1 (documented designed behavior, not a defect fix): COD/Card checkout has no idempotency key.** A double-click or client retry submits two orders — the spec pins `after - before === 2` and both < 400. Why this is *not* a violation of INV-1: INV-1 protects **payments** — a legitimate PayPal payment can never double-fulfill, which is race-proven in §2.1. COD/Card are gateway-less recorded intents (no payment confirmation exists to deduplicate on); each duplicate order correctly reserves its own stock and is admin-cancellable. Client-side disable-on-submit (frontend) is the current mitigation. If the owner wants server-side idempotency for COD/Card, an `Idempotency-Key` header + unique index is the recommended minimal design — flagged in BUG_REPORT as an enhancement, not a blocker.

**AF-2 (pre-existing, regression-guarded, owner decision): password reset does not invalidate existing JWTs.** Standard for this codebase's token design (7 d expiry); pinned by a named regression guard so the behavior is at least explicit. Invalidation requires a token-version field — an architecture change, out of minimal-fix scope.

**AF-3 (found by audit classification, fixed): dependency-level attacks** — nodemailer HIGH chain (SMTP injection/CRLF/SSRF) and extract-zip-in-prod-tree — see SECURITY_TEST_REPORT §4/§5.

## 4. What attack mode deliberately did NOT do

- No destructive DB operations, no data exfiltration attempts beyond canary strings, no attacks on any external/production host (none exist in this environment).
- No brute-force beyond the documented limiter proof (429 observed; lockout proven in `userAccountLockout`).
- PayPal attack simulations stop at the mocked network edge (signature forgery, replay, redelivery storms, amount tampering) — real PayPal attack surface requires the owner's sandbox (NOT RUN).
