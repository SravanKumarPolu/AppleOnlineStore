// PayPal webhook signature verification — Phase 1 security work area 2.
//
// Uses PayPal's official mechanism: POST /v1/notifications/verify-webhook-signature
// with the transmission headers + the webhook event exactly as received
// (parsed from the RAW request body, since PayPal signs the bytes it sent).
//
// FAIL-CLOSED: anything missing (headers, webhook id, event fields) or any
// non-SUCCESS verification status is treated as NOT verified. The controller
// refuses to touch database records for unverified events.
import paypal from '@paypal/checkout-server-sdk';
import { createPayPalEnvironment } from '../config/paypalEnv.js';

// Header names as PayPal sends them (Node lowercases all header keys).
export const REQUIRED_WEBHOOK_HEADERS = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-transmission-sig',
  'paypal-cert-url',
  'paypal-auth-algo',
];

/**
 * Build the body for PayPal's verify-webhook-signature endpoint.
 */
export function buildVerificationBody({ headers, webhookId, webhookEvent }) {
  return {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: webhookEvent,
  };
}

/**
 * Factory — a verifier bound to a specific PayPal HTTP client + webhook id.
 * Tests inject a stub client here so the real decision logic runs while the
 * network edge is controlled.
 */
export function createWebhookVerifier({ client, webhookId }) {
  return {
    async verify({ headers = {}, rawBody, event }) {
      if (!webhookId) {
        return { verified: false, reason: 'missing_webhook_id' };
      }

      const extracted = {};
      for (const header of REQUIRED_WEBHOOK_HEADERS) {
        const value = headers[header];
        if (!value || typeof value !== 'string') {
          return { verified: false, reason: `missing_header:${header}` };
        }
        extracted[header] = value;
      }

      if (!event || typeof event !== 'object' || !event.id || !event.event_type) {
        return { verified: false, reason: 'malformed_event' };
      }

      // Prefer the raw bytes PayPal signed. If the raw body is unavailable
      // (e.g. a route change bypassed the capture), fall back to the parsed
      // body — PayPal accepts the event object either way, but raw is exact.
      let webhookEvent = event;
      if (rawBody) {
        try {
          webhookEvent = JSON.parse(rawBody.toString('utf-8'));
        } catch {
          return { verified: false, reason: 'invalid_raw_body' };
        }
      }

      // Minimal sanity: parsed raw body must be the same event.
      if (webhookEvent.id !== event.id || webhookEvent.event_type !== event.event_type) {
        return { verified: false, reason: 'raw_body_mismatch' };
      }

      const request = {
        verb: 'POST',
        path: '/v1/notifications/verify-webhook-signature',
        body: buildVerificationBody({ headers: extracted, webhookId, webhookEvent }),
      };

      let response;
      try {
        response = await client.execute(request);
      } catch (error) {
        // Network/auth failure => fail-closed, with reason (no secrets logged).
        return { verified: false, reason: `verification_request_failed:${error?.message || error}` };
      }

      const status = response?.result?.verification_status;
      return { verified: status === 'SUCCESS', verificationStatus: status };
    },
  };
}

// ---------------------------------------------------------------------------
// Default verifier — constructed lazily so importing this module never
// requires PayPal credentials to be present (tests / lint / tooling).
// ---------------------------------------------------------------------------
let defaultVerifier = null;
let activeVerifierOverride = null;

function getDefaultVerifier() {
  if (!defaultVerifier) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    // Environment selection is centralized (config/paypalEnv.js) so this
    // verifier always targets the SAME PayPal environment as the capture flow.
    const client = new paypal.core.PayPalHttpClient(
      createPayPalEnvironment(clientId, clientSecret)
    );
    defaultVerifier = createWebhookVerifier({ client, webhookId: process.env.PAYPAL_WEBHOOK_ID });
  }
  return defaultVerifier;
}

export function getActiveWebhookVerifier() {
  return activeVerifierOverride || getDefaultVerifier();
}

/** Test seam: swap the verifier instance (e.g. one built with a stub client). */
export function setActiveWebhookVerifier(verifier) {
  activeVerifierOverride = verifier;
}

export function clearActiveWebhookVerifier() {
  activeVerifierOverride = null;
}

export default { getActiveWebhookVerifier, setActiveWebhookVerifier, clearActiveWebhookVerifier };
