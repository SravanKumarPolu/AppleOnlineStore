#!/usr/bin/env node
// PayPal Sandbox validation — the one command an owner runs when credentials
// are available.
//
// The automated suite verifies every PayPal DECISION offline (mocked HTTP
// edge). What it can never prove is that the credentials, the webhook
// registration and a real sandbox account agree. This script does exactly that
// round trip, step by step, and refuses to claim success for anything it did
// not observe.
//
// Usage
//   node scripts/paypal-sandbox-check.mjs --check
//       Validate configuration only (no network). Exit 0 = ready to run.
//   node scripts/paypal-sandbox-check.mjs --create
//       Create a real sandbox order + print the approve URL.
//   node scripts/paypal-sandbox-check.mjs --capture <paypalOrderId>
//       Capture it after approving in the browser; prints the capture id and
//       the exact value the shopper's order must record.
//   node scripts/paypal-sandbox-check.mjs --webhook
//       Print the URL/handler facts an operator must register with PayPal.
//
// Exit codes: 0 = step succeeded · 2 = BLOCKED (missing/placeholder config)
//             1 = the step ran and FAILED.
import 'dotenv/config'; // read backend/.env exactly like the server does
import paypal from '@paypal/checkout-server-sdk';

import { isLivePayPal, getPayPalEnvironmentName } from '../config/paypalEnv.js';
import { validateRuntimeConfig, formatStartupConfigReport } from '../config/startupValidation.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : undefined;
};

const BLOCKED = 2;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function blocked(message) {
  console.error(`⛔ BLOCKED: ${message}`);
  process.exit(BLOCKED);
}

function buildClient() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const environment = isLivePayPal()
    ? new paypal.core.LiveEnvironment(id, secret)
    : new paypal.core.SandboxEnvironment(id, secret);
  return new paypal.core.PayPalHttpClient(environment);
}

/**
 * This helper exists to validate SANDBOX behaviour. With PAYPAL_ENV=live it
 * would otherwise create (and, on --capture, charge) a REAL payment — exactly
 * the accident it is meant to prevent. Any step that talks to PayPal is
 * therefore refused unless the environment is sandbox.
 */
function assertSandboxOnly(step) {
  if (isLivePayPal()) {
    blocked(
      `${step} targets the SANDBOX only, but PAYPAL_ENV=live is configured. ` +
        'Unset PAYPAL_ENV (or set it to sandbox) and use sandbox credentials. ' +
        'This helper refuses to create or capture live payments.'
    );
  }
}

/** Mirrors the payload controllers/orderController.placeOrderPayPal builds. */
function orderRequest({ total = 11.0, currency = 'USD' } = {}) {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  const payee = String(process.env.PAYPAL_PAYEE_EMAIL || '').trim();
  const unit = {
    amount: {
      currency_code: currency,
      value: total.toFixed(2),
      breakdown: {
        item_total: { currency_code: currency, value: (total - 10).toFixed(2) },
        shipping: { currency_code: currency, value: '10.00' },
      },
    },
    description: 'NovaCart sandbox validation order',
  };
  if (payee) unit.payee = { email_address: payee };
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [unit],
    application_context: {
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/cancel`,
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
      brand_name: process.env.APP_NAME || 'NovaCart',
    },
  });
  return request;
}

function printConfigReport() {
  const report = validateRuntimeConfig();
  for (const line of formatStartupConfigReport(report)) console.log(line);
  return report;
}

async function check() {
  console.log('=== PayPal configuration check ===');
  console.log(`Environment: ${getPayPalEnvironmentName()} (PAYPAL_ENV=${process.env.PAYPAL_ENV || 'unset'})`);
  const report = printConfigReport();

  if (report.fatal.length > 0) {
    blocked('fatal configuration problems listed above — fix them before validating');
  }

  const missing = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'].filter(
    (name) => !process.env[name] || /^(your|change|replace|placeholder|example|todo|fixme)/i.test(String(process.env[name]).trim())
  );
  if (missing.length > 0) {
    blocked(`missing or placeholder: ${missing.join(', ')} — set real sandbox values in backend/.env`);
  }

  console.log('✅ Credentials are present and not placeholders.');
  console.log('Next: `node scripts/paypal-sandbox-check.mjs --create`');
}

async function create() {
  assertSandboxOnly('--create');
  const client = buildClient();
  console.log('→ Creating a real PayPal order…');
  const response = await client.execute(orderRequest());
  const order = response.result;
  const approve = (order.links || []).find((link) => link.rel === 'approve' || link.rel === 'payer-action');

  console.log(`✅ Order created: ${order.id} (status ${order.status})`);
  if (approve) {
    console.log('\nOpen this URL, log in with a SANDBOX buyer account and approve:\n');
    console.log(`   ${approve.href}\n`);
  }
  console.log('Then run:');
  console.log(`   node scripts/paypal-sandbox-check.mjs --capture ${order.id}`);
}

async function capture(orderId) {
  assertSandboxOnly('--capture');
  if (!orderId) fail('--capture needs a PayPal order id (printed by --create)');
  const client = buildClient();
  const request = new paypal.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});

  console.log(`→ Capturing ${orderId}…`);
  const response = await client.execute(request);
  const result = response.result;
  const capture = result.purchase_units?.[0]?.payments?.captures?.[0];

  if (result.status !== 'COMPLETED' || !capture) {
    fail(`capture did not complete (status ${result.status}); order left unverified`);
  }

  console.log('✅ Capture COMPLETED');
  console.log(`   capture id : ${capture.id}`);
  console.log(`   amount     : ${capture.amount.value} ${capture.amount.currency_code}`);
  console.log(`   status     : ${capture.status}`);
  console.log('\nNow confirm the application side:');
  console.log('   • the shopper order with this paypalOrderId shows paymentStatus=completed');
  console.log('   • POST /api/orders/paypal/capture with the same orderID is idempotent');
  console.log(`   • the webhook for capture ${capture.id} is accepted (not 400)`);
}

function webhookInfo() {
  const base = (process.env.PUBLIC_BACKEND_URL || '').trim();
  console.log('=== Webhook registration facts ===');
  console.log(`PAYPAL_WEBHOOK_ID : ${process.env.PAYPAL_WEBHOOK_ID ? 'set' : 'MISSING'}`);
  console.log(`Handler           : POST /api/orders/paypal/webhook`);
  console.log(`Signature source  : PayPal verify-webhook-signature API (fail-closed)`);
  if (!base) {
    console.log('\nPUBLIC_BACKEND_URL is not set, so the exact URL cannot be printed.');
    console.log('Register:  https://<your-public-host>/api/orders/paypal/webhook');
  } else {
    console.log(`Register:  ${base.replace(/\/+$/, '')}/api/orders/paypal/webhook`);
  }
  console.log('\nEvents required: PAYMENT.CAPTURE.COMPLETED');
  console.log('The endpoint rejects unsigned requests with 400 by design — a 400');
  console.log('from a browser/curl test is expected; only a PayPal delivery can pass.');
}

async function main() {
  if (has('--webhook')) return webhookInfo();
  if (has('--create')) return create();
  if (has('--capture')) return capture(valueOf('--capture'));
  return check();
}

main().catch((error) => {
  // Never print the raw SDK error body: it can contain payer data.
  console.error(`❌ ${error?.message || 'unexpected failure'}`);
  process.exit(1);
});
