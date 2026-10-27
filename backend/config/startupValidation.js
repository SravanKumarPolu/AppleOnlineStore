// Startup credential guardrails — pre-production readiness work area
// (credential rotation + sandbox validation).
//
// Catches, at BOOT time, the two ways a deploy silently breaks payments:
//   1. Missing / placeholder credentials (copied .env.example values) —
//      payments and webhooks fail request-by-request, orders stick 'pending'.
//   2. Environment disagreement — NODE_ENV=production without PAYPAL_ENV=live
//      (a prod build quietly talking to sandbox) or the reverse (live
//      credentials in a dev/test build).
//
// Escalation ladder (deliberate, so no legitimate staging topology is blocked):
//   FATAL (exit 1 before listen):
//     - PAYPAL_ENV=live with missing/placeholder PayPal credentials — an
//       explicit live configuration must never boot half-credentialed.
//     - NODE_ENV=production with missing/placeholder JWT_SECRET — auth is
//       broken in production.
//   WARNING (boot continues, loud structured log line):
//     - Any other missing/placeholder credential (sandbox/staging may be
//       intentionally partial; the warning makes it a visible decision).
//     - NODE_ENV=production while PayPal targets sandbox (could be a staging
//       host running a prod build — but it must be a CHOICE).
//     - PAYPAL_ENV=live while NODE_ENV is not production (suspicious inverse).
//
// Pure + dependency-free so the test suite can drive the whole matrix offline.
import { isLivePayPal, getPayPalEnvironmentName } from './paypalEnv.js';

// Values that appear verbatim in backend/.env.example / env.example. A real
// credential never looks like these. Generic 'your-*' / 'changeme' / 'replace'
// / 'placeholder' / 'example' prefixes cover hand-edited variants.
const PLACEHOLDER_EXACT = new Set([
  'your-super-secret-jwt-key-here',
  'your-paypal-client-id',
  'your-paypal-client-secret',
  'your-paypal-webhook-id',
  'your-admin-password',
  'secure-admin-password',
]);
const PLACEHOLDER_PATTERN = /^(your|change|replace|placeholder|example|todo|fixme)[-_*]/i;

// Loose but sufficient: PayPal rejects malformed payee addresses, so a typo
// must surface at boot rather than at the first checkout.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Domains reserved for examples/tests (RFC 2606 + the sandbox convention this
// repository used to hardcode).
const SAMPLE_DOMAIN_PATTERN = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test|invalid|localhost)$/i;

function isPlaceholder(value) {
  if (typeof value !== 'string') return true;
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return PLACEHOLDER_EXACT.has(v) || PLACEHOLDER_PATTERN.test(v);
}

/**
 * Validate the runtime credential configuration.
 * Returns { fatal: string[], warnings: string[], paypalEnvironment }.
 * Never throws and never logs secrets — messages name the VARIABLE only.
 */
export function validateRuntimeConfig({
  env = process.env,
  nodeEnv = env.NODE_ENV,
  paypalEnv = env.PAYPAL_ENV,
} = {}) {
  const fatal = [];
  const warnings = [];
  const isProduction = String(nodeEnv || '').trim().toLowerCase() === 'production';
  const live = isLivePayPal(paypalEnv);

  const flag = (name, value, consequence, { fatalInProd = false, fatalWhenLive = false } = {}) => {
    if (value && !isPlaceholder(value)) return false;
    const problem = `${name} is ${value ? 'a placeholder value' : 'not set'} — ${consequence}`;
    if (fatalWhenLive && live) fatal.push(problem);
    else if (fatalInProd && isProduction) fatal.push(problem);
    else warnings.push(problem);
    return true;
  };

  // --- Payment credentials -------------------------------------------------
  flag('PAYPAL_CLIENT_ID', env.PAYPAL_CLIENT_ID, 'PayPal order creation, capture and webhook verification will all fail', { fatalWhenLive: true });
  flag('PAYPAL_CLIENT_SECRET', env.PAYPAL_CLIENT_SECRET, 'PayPal order creation, capture and webhook verification will all fail', { fatalWhenLive: true });
  flag('PAYPAL_WEBHOOK_ID', env.PAYPAL_WEBHOOK_ID, 'every incoming webhook fails signature verification and is rejected (orders stay pending)', { fatalWhenLive: true });

  // --- PayPal payee (optional) -------------------------------------------
  // The payee used to be hardcoded to a sandbox address, which a live
  // deployment would inherit. It is now opt-in: unset means "the account that
  // owns the credentials". A sandbox/example payee combined with live
  // credentials would route real money to a test account, so that is fatal.
  const payeeEmail = typeof env.PAYPAL_PAYEE_EMAIL === 'string' ? env.PAYPAL_PAYEE_EMAIL.trim() : '';
  if (!payeeEmail) {
    // Unset is the documented default: PayPal routes the payment to the
    // business account that owns the credentials. Nothing to flag.
  } else if (isPlaceholder(payeeEmail) || !EMAIL_PATTERN.test(payeeEmail)) {
    const problem =
      'PAYPAL_PAYEE_EMAIL is not a valid email address — PayPal order creation will be rejected';
    if (live) fatal.push(problem);
    else warnings.push(problem);
  } else if (SAMPLE_DOMAIN_PATTERN.test(payeeEmail)) {
    const problem =
      'PAYPAL_PAYEE_EMAIL points at an example/test domain while PAYPAL_ENV=live — real payments would be routed to a sandbox account';
    if (live) fatal.push(problem);
    else warnings.push(problem);
  }

  // --- Auth secrets ---------------------------------------------------------
  flag('JWT_SECRET', env.JWT_SECRET, 'all authenticated routes (incl. admin) reject every request', { fatalInProd: true });

  // --- Admin login (validated by controllers/userController.js) ------------
  flag('ADMIN_EMAIL', env.ADMIN_EMAIL, 'admin panel login is unavailable');
  flag('ADMIN_PASSWORD', env.ADMIN_PASSWORD, 'admin panel login is unavailable');

  // --- Environment agreement (explicit choice required) --------------------
  if (isProduction && !live) {
    warnings.push(
      `NODE_ENV=production but PAYPAL_ENV is not "live" — all PayPal traffic targets SANDBOX. ` +
        'Intentional for a staging host; set PAYPAL_ENV=live before accepting real payments.'
    );
  }
  if (live && !isProduction) {
    warnings.push(
      `PAYPAL_ENV=live while NODE_ENV is "${nodeEnv || 'development'}" — LIVE credentials in a non-production build. ` +
        'Confirm this is intended before proceeding.'
    );
  }

  return { fatal, warnings, paypalEnvironment: getPayPalEnvironmentName(paypalEnv) };
}

/** Human-facing summary for startup logs. Names variables, never values. */
export function formatStartupConfigReport({ fatal, warnings, paypalEnvironment }) {
  const lines = [`PayPal environment: ${paypalEnvironment.toUpperCase()}`];
  for (const problem of fatal) lines.push(`🛑 FATAL CONFIG: ${problem}`);
  for (const problem of warnings) lines.push(`🚨 CONFIG WARNING: ${problem}`);
  return lines;
}

export { isPlaceholder };

export default { validateRuntimeConfig, formatStartupConfigReport, isPlaceholder };
