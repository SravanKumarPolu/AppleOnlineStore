# Known Limitations — Pre-DevOps State

**Date:** 2026-10-26. Honest inventory of everything that is NOT done, NOT verified, or accepted as-is. Items are ordered by operational impact.

---

## 1. Blocked validations (external credentials unavailable)

1. **PayPal live-path validation** — no sandbox credentials in this environment. All PayPal decision logic is verified offline via test seams (order creation, capture verification incl. amount/currency mismatch, webhook signature failure, idempotency, unmatched-capture reconciliation, retry budget). A real end-to-end round trip (create → approve → capture → webhook) against the PayPal sandbox remains **BLOCKED** until credentials are provided. Checklist: `docs/devops/08-PAYPAL-SANDBOX-VALIDATION-CHECKLIST.md`.
2. **SMTP live delivery** — no SMTP credentials; email rendering and failure paths are tested, actual deliverability (SPF/DKIM/etc.) is not.
3. **Manual smoke runner** (`npm run test:smoke`) — requires a live database and SMTP; intentionally not executed against any real infrastructure.

## 2. Accepted risks / deferred work

1. **Tailwind 3 build-chain advisories (frontend)** — 3 moderate findings in `postcss-selector-parser` (via `postcss-nested`/`tailwindcss 3.4.17`), build-time only (devDependency chain, not shipped). The only remediation is the breaking tailwind 4 upgrade — deferred to a dedicated window with visual regression (the admin app is already on tailwind 4 and can serve as reference).
2. **PayPal payee pin** — `placeOrderPayPal` hardcodes `payee.email_address` to the sandbox business account `sb-business@business.example.com`. Required for the current sandbox topology; **must be removed/made configurable before live payments**. The startup guardrails (fatal when live credentials are placeholders) reduce but do not eliminate this risk — a fully-credentialed live deployment would still carry the pin.
3. **No automatic stock release for abandoned PayPal orders** — stock is reserved at PayPal order creation and released only on admin cancellation. An unpaid/abandoned order holds inventory indefinitely. A TTL/expiry policy is a deliberate business decision, intentionally not invented here.
4. **No refund workflow** — `paymentStatus: 'refunded'` exists in the schema and is protected from webhook clobbering, but no endpoint implements refunds.
5. **Admin identity is environment-based** (single `ADMIN_EMAIL`/`ADMIN_PASSWORD`, direct comparison) — no MFA, no DB-backed admin accounts, no constant-time comparison. Adequate for a single-operator store; harden before multi-operator use.
6. **Socket.IO is single-process** (in-memory adapter) — multi-replica scaling requires sticky sessions or a Redis adapter; also, `GET /api/socket/status` and the connected-users map are per-process only. Long-lived sockets are not re-validated against `tokenVersion`.
7. **No TLS anywhere in the current topology** — the API assumes upstream termination (DevOps phase).
8. **`orderModel.items[].productId` is a String** (historical). Analytics joins normalize it (`$convert`); any new aggregation must do the same. Type migration deliberately out of scope.
9. **Mongoose duplicate-index warnings** on `users.email` and `categories.name` (declared twice in schema definitions). Harmless (server dedupes) — cosmetic cleanup deferred to avoid schema churn in stabilization.
10. **Stale SKR branding remnants** — `frontend/index.html` og:url/og:image metadata and PWA manifest still reference `skr-e-commerce.netlify.app`. Cosmetic; no functional effect (CORS no longer references the domain).
11. **Legacy root-level debug/fix scripts and ~20 historical PAYPAL_*.md reports** remain in the repository root as history. They are not part of any test/build path. Candidate for archival in the DevOps phase; not removed now (preserving user artifacts).
12. **Two env templates coexist** — `backend/env.example` and `frontend/env.example` (no dot) are legacy exhaustive templates listing many variables no code reads; both now carry a supersession header pointing at the authoritative `.env.example` files.
13. **Accessibility coverage is basic** — landmarks, alt text, single h1, keyboard navigation. No full WCAG 2.1 audit, no screen-reader-specific E2E.
14. **Performance numbers are sandbox baselines** — in-memory MongoDB, shared 2-vCPU sandbox, read/auth-heavy mix, 500-VU level intentionally skipped. They are comparable baselines for the DevOps phase, not production capacity guarantees.
15. **`userOrders`/`allOrders` pagination detail** — `allOrders` computes `totalPages` from the raw `limit` while clamping the actual page size to 100; harmless for current clients, noted for a future cleanup.
16. **Cart has no server-side stock/price validation on mutation** — by design, validation happens at checkout (documented in `CHECKOUT_PAYMENT_FLOW.md`); carts may reference since-deleted products until checkout rejects them.

## 3. Compatibility notes (intentional behavior changes in this phase)

| Change | Old behavior | New behavior | Compatibility |
|---|---|---|---|
| Admin token on shopper route | passed middleware (`req.user.id = null`), rejected per-controller with 400/401 | rejected centrally with 403 | No known client affected (admin console never calls shopper endpoints) |
| Debug endpoints in production | admin-only, active | 404 for everyone unless `ENABLE_DEBUG_ENDPOINTS=true` | No frontend/admin usage; operators must opt in explicitly |
| CORS origins | hardcoded Netlify production origins + dev ports | dev origins + env-driven production origins | A deployment on the old Netlify domains must set `FRONTEND_URL`/`ADMIN_URL`/`CORS_EXTRA_ORIGINS` |
| Socket.IO origins | included ports 5175–5177 | dev origins + env URLs | Ports 5175–5177 must come from env if ever needed (no current consumer) |
| `npm test` (backend) | manual smoke runner | Jest regression suite | Smoke runner is now `npm run test:smoke` |
| `MONGODB_URI` handling | `/e-commerce` appended blindly | complete URI respected; bare host gets default db | Bare-host deployments unchanged; complete URIs now work correctly |
