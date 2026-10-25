// Phase 1 work area 2 — PayPal webhook security.
// The ONLY stub is the PayPal HTTP client (network edge); all decision logic
// (header extraction, raw-body handling, fail-closed paths, dedupe, DB
// gating) executes for real against an in-memory MongoDB.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  createTestOrderDoc,
  WEBHOOK_HEADERS,
  webhookEvent,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';
import webhookEventModel from '../models/webhookEventModel.js';
import {
  createWebhookVerifier,
  setActiveWebhookVerifier,
  clearActiveWebhookVerifier,
} from '../services/paypalWebhookService.js';

let db;
let orderId;

// Stub PayPal client: returns SUCCESS/FAILURE based on the transmission-sig
// header value, and records the request it received so tests can assert the
// real verifier logic passed the correct data to PayPal.
function makeStubClient(statusFor = {}) {
  const calls = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      const sig = request.body?.transmission_sig;
      const status = statusFor[sig] ?? 'SUCCESS';
      return { result: { verification_status: status } };
    },
  };
}

beforeAll(async () => {
  db = await startTestDb();
  const user = await createTestUserDoc('user');
  const order = await createTestOrderDoc(user._id, {
    paypalCaptureId: 'CAP-TEST-123',
    paymentStatus: 'pending',
  });
  orderId = order._id;
});

afterAll(async () => {
  clearActiveWebhookVerifier();
  await stopTestDb(db);
});

describe('POST /api/orders/paypal/webhook', () => {
  it('accepts a valid event and completes the matching order', async () => {
    const client = makeStubClient();
    setActiveWebhookVerifier(createWebhookVerifier({ client, webhookId: 'WH-TEST' }));

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-VALID', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const order = await orderModel.findById(orderId);
    expect(order.paymentStatus).toBe('completed');

    // The verifier logic really ran: PayPal request was built correctly,
    // using the raw request body and the webhook id.
    expect(client.calls.length).toBe(1);
    const sent = client.calls[0];
    expect(sent.verb).toBe('POST');
    expect(sent.path).toBe('/v1/notifications/verify-webhook-signature');
    expect(sent.body.webhook_id).toBe('WH-TEST');
    expect(sent.body.transmission_id).toBe(WEBHOOK_HEADERS['paypal-transmission-id']);
    expect(sent.body.webhook_event.id).toBe('WH-EVT-VALID');
  });

  it('rejects an invalid signature with 400 and does NOT update the order', async () => {
    // Reset the order to pending to observe any illegal write.
    await orderModel.updateOne({ _id: orderId }, { paymentStatus: 'pending' });

    const client = makeStubClient({ 'bad-signature': 'FAILURE' });
    setActiveWebhookVerifier(createWebhookVerifier({ client, webhookId: 'WH-TEST' }));

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set({ ...WEBHOOK_HEADERS, 'paypal-transmission-sig': 'bad-signature' })
      .send(webhookEvent('WH-EVT-BADSIG'));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const order = await orderModel.findById(orderId);
    expect(order.paymentStatus).toBe('pending'); // untouched
  });

  it('rejects missing signature headers with 400 (fail-closed)', async () => {
    await orderModel.updateOne({ _id: orderId }, { paymentStatus: 'pending' });
    const client = makeStubClient();
    setActiveWebhookVerifier(createWebhookVerifier({ client, webhookId: 'WH-TEST' }));

    const { 'paypal-transmission-sig': _omit, ...headersWithoutSig } = WEBHOOK_HEADERS;
    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(headersWithoutSig)
      .send(webhookEvent('WH-EVT-NOHEADER'));

    expect(res.status).toBe(400);
    const order = await orderModel.findById(orderId);
    expect(order.paymentStatus).toBe('pending');
    // The stub client must never even be called without complete headers.
    expect(client.calls.length).toBe(0);
  });

  it('rejects malformed event bodies with 400', async () => {
    const client = makeStubClient();
    setActiveWebhookVerifier(createWebhookVerifier({ client, webhookId: 'WH-TEST' }));

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send({ someRandom: 'payload' });

    expect(res.status).toBe(400);
  });

  it('fail-closes when no webhook id is configured', async () => {
    const client = makeStubClient();
    setActiveWebhookVerifier(createWebhookVerifier({ client, webhookId: undefined }));

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-NOID'));

    expect(res.status).toBe(400);
    expect(client.calls.length).toBe(0);
  });

  it('ignores duplicate events (replay protection) without re-processing', async () => {
    const client = makeStubClient();
    setActiveWebhookVerifier(createWebhookVerifier({ client, webhookId: 'WH-TEST' }));

    const event = webhookEvent('WH-EVT-DUP', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123');

    // First delivery processes normally.
    const first = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(event);
    expect(first.status).toBe(200);
    expect((await orderModel.findById(orderId)).paymentStatus).toBe('completed');

    // Reset the order — if dedupe works, the duplicate cannot update it again.
    await orderModel.updateOne({ _id: orderId }, { paymentStatus: 'pending' });

    const second = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(event);

    expect(second.status).toBe(200);
    expect(second.body.message).toMatch(/Duplicate/i);

    const order = await orderModel.findById(orderId);
    expect(order.paymentStatus).toBe('pending'); // dedupe prevented processing

    // Exactly one processed-event record exists for this event id.
    const records = await webhookEventModel.find({ eventId: 'WH-EVT-DUP' });
    expect(records.length).toBe(1);
  });
});
