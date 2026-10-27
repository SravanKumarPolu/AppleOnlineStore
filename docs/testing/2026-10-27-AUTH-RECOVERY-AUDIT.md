# 2026-10-27 — Customer Frontend Authentication & Password-Recovery Audit

**Scope:** the customer storefront auth journey — Login → Forgot Password →
Reset Email → Reset Password → Login Successfully (customer frontend only;
admin untouched by this pass). Executed per the audit brief; fixes limited to
verified defects; design preserved.

**Tree state during the audit:** HEAD `9f81053` + uncommitted changes. A
parallel session hardened **admin** login in the same working tree
(`adminLogin` email normalization, console-log scrubbing,
`validateAdminLogin` `.trim()` replacing the aggressive `.normalizeEmail()`,
backend `adminAuthentication.spec.js` +129 lines, `docs/08` sync). Zero
overlap with the customer-auth surface; the backend suite (43/449) and admin
gate (13/71) were run WITH those changes and pass.

## 1. Files inspected (Phase 1)

`frontend/src/pages/Login.tsx`, `frontend/src/pages/ResetPassword.tsx`,
`frontend/src/components/PasswordRecovery.tsx`,
`frontend/src/hooks/useAuth.ts`, `frontend/src/context/ShopContext.tsx`,
`frontend/src/hooks/useCart.ts` / `useProducts.ts` / `useWebSocket.ts` /
`useCategories.ts` / `components/AddressBook.tsx` / `components/PayPalPayment.tsx`
(API base URLs), `frontend/src/main.tsx` (ToastContainer),
`frontend/src/test/{helpers,setup}.ts(x)`, `frontend/vite.config.ts` (PWA
workbox config), `frontend/index.html`, `frontend/e2e/{ui-audit,a11y,
checkout}.spec.ts`, existing tests (`Login.test.tsx`, `ResetPassword.test.tsx`,
24-file suite), and the backend contract
(`controllers/userController.js` loginUser / requestPasswordReset /
resetPassword, `services/emailService.js` reset-link builder,
`middleware/validation.js`).

## 2. Verified contract matches (no change needed)

- Endpoints: `POST /api/user/login` · `/register` · `/forgot-password` ·
  `/reset-password` — all wired to `VITE_BACKEND_URL || http://localhost:3001`.
- Reset payload `{ token, newPassword }` = backend contract; reset link format
  `FRONTEND_URL/reset-password?token=<raw>` = the page's `?token=` read.
- Password policy identical on both sides: ≥8 chars + upper + lower + digit +
  special `@$!%*?&` (registration: also enforced by `validateUserRegistration`).
- Enumeration protection: backend returns the same success body for unknown
  emails; the modal's confirmation copy stays account-agnostic.
- Session invalidation: backend `resetPassword` bumps `tokenVersion` (AF-2) —
  every pre-reset JWT is rejected afterwards (verified by
  `passwordResetConsumption.spec.js` and re-proven by `verify:old-credentials`).
- PWA: workbox `runtimeCaching` covers only fonts/PayPal/Cloudinary — auth
  POSTs are never cached; `navigateFallback` serves the SPA shell for
  `/reset-password?token=…` (token is read client-side, never cached).
- No axios in the storefront (K-10) → no stale-token interceptor on public
  reset requests; tokens are never logged, never sent to third parties.
- Remember Me controls only the localStorage `rememberedEmail` prefill.
- Token in localStorage is an XSS-theft consideration inherent to the current
  architecture; changing to httpOnly cookies would be a backend+frontend
  redesign — documented, deliberately unchanged.

## 3. Confirmed defects → fixes applied (all customer-frontend only)

| # | Defect (verified) | Fix | File |
|---|---|---|---|
| D1 | Forgot-password failures were completely silent (400/429/500/network → `onRecoveryRequest:false` → no UI feedback) | Safe generic error + `role="alert"`; network errors get a distinct message | `PasswordRecovery.tsx` |
| D2 | Modal had no dialog semantics or focus management (no role/aria-modal, no initial focus, no trap, no Escape, no focus restore) | `role="dialog"` + `aria-modal` + `aria-labelledby`, focus in/trap/restore, Escape closes (not while sending) | `PasswordRecovery.tsx` |
| D3 | Login email not normalized while registration lowercases (backend `findOne({email})` is exact-case) → mixed-case/padded email = false "Invalid credentials" | `email.trim().toLowerCase()` at login, forgot-password and registration submission; validation accepts trimmed input | `Login.tsx` |
| D4 | `minLength={8}` on the login password blocked migrated users with pre-policy short passwords from submitting (server has no length check on login) | `minLength` now signup-only | `Login.tsx` |
| D5 | Missing `autoComplete` attributes (password managers / WCAG) | `email`, `current-password` (login) / `new-password` (signup + reset ×2) | `Login.tsx`, `PasswordRecovery.tsx`, `ResetPassword.tsx` |
| D6 | Reset-page visibility toggles had no `aria-label` (icon-only) | Added, distinct per field | `ResetPassword.tsx` |
| D7 | After a successful reset the stale local session and submitted passwords persisted (dead-token bounce via Login's `isLoggedIn` redirect) | Success clears both passwords + `setToken("")` (matches backend AF-2) | `ResetPassword.tsx` |
| D8 | Google/Facebook buttons were silent no-ops; the biometric button ran a client-only WebAuthn probe that could "succeed" without ever logging the shopper in | Explicit unavailable-state toasts; fake probe removed (no new OAuth/biometric infra) | `Login.tsx` |
| D9 | No referrer policy — reset links carry `?token=` in the URL | `<meta name="referrer" content="strict-origin-when-cross-origin">` | `index.html` |
| + | Success copy lacked inbox/spam guidance and could imply delivery confirmation | "If an account exists for this email address, a password reset link is on its way. Please check your inbox and spam folder." + `role="status"` | `PasswordRecovery.tsx` |
| + | Modal email starts empty even when the shopper typed their address | Editable `initialEmail` prefill from the login form | `Login.tsx`, `PasswordRecovery.tsx` |

Error pages show only curated messages — no raw axios/network errors, no
tokens, no account-existence hints.

## 4. Automated tests (Phase 10/11)

New `src/__tests__/components/PasswordRecovery.test.tsx` (11 tests): dialog
semantics + focus in/trap/Escape/restore (incl. Login integration), prefill,
success copy, **failure-never-silent** (false + thrown), loading state,
duplicate-submission guard, Escape-while-sending.

Extended `Login.test.tsx` (+4): login email normalization (trim + lowercase),
remembered-email normalization, legacy-length password submits in Login mode,
unavailable Google/Facebook/biometric announcements.

Extended `ResetPassword.test.tsx` (+2): success clears passwords + stale
`setToken("")`, toggle aria-labels.

Extended `e2e/ui-audit.spec.ts` (+1): real-browser recovery modal — opens,
focus moves in, Escape closes, submission always yields visible feedback
(deterministic enumeration-safe success path against the real E2E backend).

## 5. Gate results (all executed 2026-10-27, after the fixes)

| Gate | Result |
|---|---|
| `frontend npm run lint` / `type-check` | ✅ clean |
| `frontend npm run test -- --run` | ✅ **25 files / 142 tests** (was 24/125) |
| `frontend npm run build` | ✅ PWA precache emitted |
| `frontend npm run test:e2e` (`E2E_PORT=3101 E2E_WEB_PORT=5273` — 3001/5173 were occupied by the parallel session's dev servers) | ✅ **54/54** (18 × Chromium/Firefox/WebKit, 8.5 m) |
| `backend npm run lint` / `build` | ✅ (104 files) |
| `backend npm run test:security` | ✅ **43 suites / 449 tests** (incl. the parallel admin-hardening specs) |
| `admin npm run lint` / `type-check` / `test --run` / `build` | ✅ **13 files / 71 tests** |

**No other core feature regressed**: the backend route surface (46 handlers),
storefront routes/pages, PWA config, checkout/E2E money path and admin gate
all pass unchanged alongside this work.

## 6. Real email delivery — BLOCKED (external)

The E2E/backend logs confirm `Email service not initialized` — no SMTP
credentials are configured in this environment, so **real delivery could not
be verified**. `forgot-password` correctly returns 500 and clears the token
when sending fails. To verify delivery end-to-end, set the private SMTP
configuration (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_SECURE`, `EMAIL_FROM`, `EMAIL_FROM_NAME`) and run
`npm run email:test` with `TEST_EMAIL_TO` set, then request a real reset for
a synthetic account.

## 7. Remaining manual steps

1. Configure SMTP (above) and verify real delivery — the only BLOCKED item.
2. Social/biometric sign-in remain unwired by design (announced as
   unavailable); implementing them is a separate task.
3. Commit: the recommended message covers both this pass and the parallel
   admin hardening if they land together:
   `fix(auth): harden customer password recovery UX/a11y, normalize login email, announce unavailable social sign-in`

## 8. Verdict

**PASS** (code-side, fully gated). The single BLOCKED sub-item — real SMTP
delivery — requires owner credentials only; every executable gate is green
and no existing feature was damaged.
