// PayPal environment selection — single source of truth (pre-production
// readiness work area: credential rotation + sandbox validation).
//
// WHY THIS EXISTS: the capture flow (controllers/orderController.js) and the
// webhook verifier (services/paypalWebhookService.js) previously chose their
// PayPal environment through DIFFERENT signals — one keyed off NODE_ENV, the
// other off PAYPAL_ENV. A production deployment with PAYPAL_ENV unset would
// then capture LIVE payments while verifying webhooks against SANDBOX: every
// live webhook would fail signature verification, be rejected with a 400, and
// orders would be left 'pending' — the same failure class as the unmatched-
// capture bug. Both integration points now build their environment from this
// module, so they can never disagree.
//
// Selection rule (explicit opt-in to live, fail-safe default):
//   PAYPAL_ENV=live  -> LiveEnvironment   (real money, everywhere)
//   anything else    -> SandboxEnvironment (default; never hit live by accident)
//
// The startup guardrails in config/startupValidation.js warn when
// NODE_ENV=production runs without PAYPAL_ENV=live (and vice versa), so an
// explicit decision is required — never an accident.
import paypal from '@paypal/checkout-server-sdk';

export const PAYPAL_ENV_LIVE = 'live';

/** True only when PAYPAL_ENV is exactly 'live' (case-insensitive, trimmed). */
export function isLivePayPal(paypalEnv = process.env.PAYPAL_ENV) {
  return String(paypalEnv ?? '')
    .trim()
    .toLowerCase() === PAYPAL_ENV_LIVE;
}

/** 'live' or 'sandbox' — for logs, health output, and startup checks. */
export function getPayPalEnvironmentName(paypalEnv = process.env.PAYPAL_ENV) {
  return isLivePayPal(paypalEnv) ? 'live' : 'sandbox';
}

/**
 * Build the SDK environment every PayPal client in this app must use.
 * Credentials are read by the CALLER so each integration point can keep its
 * own lazy/test-seam behavior — only the environment CHOICE is centralized.
 */
export function createPayPalEnvironment(clientId, clientSecret, paypalEnv = process.env.PAYPAL_ENV) {
  return isLivePayPal(paypalEnv)
    ? new paypal.core.LiveEnvironment(clientId, clientSecret)
    : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

export default { isLivePayPal, getPayPalEnvironmentName, createPayPalEnvironment, PAYPAL_ENV_LIVE };
