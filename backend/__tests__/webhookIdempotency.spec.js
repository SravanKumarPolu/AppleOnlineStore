// Final gate Task 1 — recoverable webhook idempotency.
// The ONLY stub is the PayPal HTTP client (network edge). The state machine
// (acquisition, lock window, failure marking, recovery of interrupted /
// failed / legacy records) executes for real against in-memory MongoDB.
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

function stubClient() {
  return {
    async execute() {
      return { result: { verification_status: 'SUCCESS' } };
    },
  };
}

function activateVerifier() {
  setActiveWebhookVerifier(createWebhookVerifier({ client: stubClient(), webhookId: 'WH-TEST' }));
}

// Seed an event record directly in the collection so mongoose timestamps
// don't fight the historical values we need to simulate.
async function seedEventDoc({ eventId, status, updatedAtMs, attempts = 1 }) {
  const now = Date.now();
  const updatedAt = new Date(updatedAtMs ?? now - 3600_000);
  const doc = {
    eventId,
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    resourceId: 'CAP-TEST-123',
    attempts,
    lastError: status === 'failed' ? 'simulated previous failure' : null,
    completedAt: status === 'completed' ? new Date(updatedAt.getTime() + 1000) : null,
    result: status === 'completed' ? 'order_updated' : null,
    processedAt: updatedAt,
    createdAt: new Date(now - 7200_000),
    updatedAt,
    __v: 0,
  };
  if (status) doc.status = status;
  await webhookEventModel.collection.insertOne(doc);
}

async function resetOrderToPending() {
  await orderModel.updateOne({ _id: orderId }, { paymentStatus: 'pending' });
}

async function getEventDoc(eventId) {
  return webhookEventModel.findOne({ eventId }).lean();
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

describe('POST /api/orders/paypal/webhook — recoverable idempotency', () => {
  it('re-acquires and processes an INTERRUPTED (stale processing) event', async () => {
    await resetOrderToPending();
    await seedEventDoc({ eventId: 'WH-EVT-STALE', status: 'processing', updatedAtMs: Date.now() - 300_000 });
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-STALE', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // THE regression: the interrupted event actually completed the order.
    const order = await orderModel.findById(orderId);
    expect(order.paymentStatus).toBe('completed');

    const doc = await getEventDoc('WH-EVT-STALE');
    expect(doc.status).toBe('completed');
    expect(doc.result).toBe('order_updated');
    expect(doc.attempts).toBe(2); // re-acquisition increments attempts
  });

  it('does NOT acknowledge while another delivery holds a FRESH lock', async () => {
    await resetOrderToPending();
    await seedEventDoc({ eventId: 'WH-EVT-FRESH', status: 'processing', updatedAtMs: Date.now() });
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-FRESH', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

    // 500 => PayPal retries later; never acknowledged as done.
    expect(res.status).toBe(500);

    const order = await orderModel.findById(orderId);
    expect(order.paymentStatus).toBe('pending'); // untouched

    const doc = await getEventDoc('WH-EVT-FRESH');
    expect(doc.status).toBe('processing');
    expect(doc.attempts).toBe(1); // lock was NOT re-acquired
  });

  it('re-processes an event previously marked failed', async () => {
    await resetOrderToPending();
    await seedEventDoc({ eventId: 'WH-EVT-FAILED', status: 'failed' });
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-FAILED', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

    expect(res.status).toBe(200);
    expect((await orderModel.findById(orderId)).paymentStatus).toBe('completed');
    const doc = await getEventDoc('WH-EVT-FAILED');
    expect(doc.status).toBe('completed');
    expect(doc.lastError).toBeNull(); // failure bookkeeping cleared
  });

  it('re-processes LEGACY records written before the state machine existed', async () => {
    await resetOrderToPending();
    await seedEventDoc({ eventId: 'WH-EVT-LEGACY', status: undefined });
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-LEGACY', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

    expect(res.status).toBe(200);
    expect((await orderModel.findById(orderId)).paymentStatus).toBe('completed');
    const doc = await getEventDoc('WH-EVT-LEGACY');
    expect(doc.status).toBe('completed');
  });

  it('marks FAILED on a processing error, then SUCCEEDS on the retry delivery', async () => {
    await resetOrderToPending();
    activateVerifier();

    // One-shot failure at the exact seam that used to strand events: the
    // order update itself throws on the first delivery only. (The order write
    // moved from findOneAndUpdate to a guarded updateOne in final gate Task 6
    // — the stub follows the write path.)
    const originalUpdateOne = orderModel.updateOne.bind(orderModel);
    let armed = true;
    orderModel.updateOne = async (...args) => {
      if (armed) {
        armed = false;
        throw new Error('simulated order update failure mongodb://u:pw@host/db');
      }
      return originalUpdateOne(...args);
    };

    let first;
    let second;
    try {
      first = await request(app)
        .post('/api/orders/paypal/webhook')
        .set(WEBHOOK_HEADERS)
        .send(webhookEvent('WH-EVT-FAILRETRY', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

      // Failed delivery: 500 (PayPal retries), record marked failed — NOT
      // acknowledged as completed.
      expect(first.status).toBe(500);
      expect((await orderModel.findById(orderId)).paymentStatus).toBe('pending');

      const failedDoc = await getEventDoc('WH-EVT-FAILRETRY');
      expect(failedDoc.status).toBe('failed');
      expect(failedDoc.lastError).toBeTruthy();
      // Failure bookkeeping is redacted — the fake connection string's
      // credentials must not be persisted in lastError.
      expect(failedDoc.lastError).not.toContain('u:pw@');

      // PayPal retries the SAME event id: the retry must re-process (the old
      // implementation would have 200'd "Duplicate event ignored" here and
      // the order update would be lost forever).
      second = await request(app)
        .post('/api/orders/paypal/webhook')
        .set(WEBHOOK_HEADERS)
        .send(webhookEvent('WH-EVT-FAILRETRY', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));
    } finally {
      orderModel.updateOne = originalUpdateOne;
    }

    expect(second.status).toBe(200);
    expect((await orderModel.findById(orderId)).paymentStatus).toBe('completed');
    const doc = await getEventDoc('WH-EVT-FAILRETRY');
    expect(doc.status).toBe('completed');
    expect(doc.attempts).toBe(2);
  });

  it('acknowledges only COMPLETED duplicates (replay protection preserved)', async () => {
    await resetOrderToPending();
    await seedEventDoc({ eventId: 'WH-EVT-DONE', status: 'completed' });
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-DONE', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-TEST-123'));

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Duplicate/i);
    // The replayed event did NOT re-process.
    expect((await orderModel.findById(orderId)).paymentStatus).toBe('pending');
    const doc = await getEventDoc('WH-EVT-DONE');
    expect(doc.attempts).toBe(1); // untouched
  });

  it('defers an UNMATCHED capture for retry instead of acknowledging it (final gate Task 6)', async () => {
    activateVerifier();
    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-UNKNOWN-CAPTURE', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-DOES-NOT-EXIST'));

    // 500 tells PayPal to redeliver — the order row may appear later
    // (delayed order creation). The old implementation acknowledged with 200
    // and a terminal record, permanently losing the payment-status update.
    expect(res.status).toBe(500);

    const doc = await getEventDoc('WH-EVT-UNKNOWN-CAPTURE');
    expect(doc.status).toBe('unresolved');
    expect(doc.result).toBe('no_matching_order');
    expect(doc.attempts).toBe(1);
  });

  it('acknowledges non-capture event types without touching orders', async () => {
    await resetOrderToPending();
    activateVerifier();
    // PAYMENT.CAPTURE.REFUNDED is no longer an ignored type (refunds are
    // reconciled through it) — use an event this app genuinely does not act on.
    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-OTHER-TYPE', 'CHECKOUT.ORDER.APPROVED', 'CAP-TEST-123'));

    expect(res.status).toBe(200);
    expect((await orderModel.findById(orderId)).paymentStatus).toBe('pending');
    const doc = await getEventDoc('WH-EVT-OTHER-TYPE');
    expect(doc.status).toBe('completed');
    expect(doc.result).toBe('ignored_event_type');
  });

  it('rejects a malformed capture resource BEFORE writing any event record', async () => {
    activateVerifier();
    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send({ id: 'WH-EVT-NORESOURCE', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} });

    expect(res.status).toBe(400);
    const doc = await getEventDoc('WH-EVT-NORESOURCE');
    expect(doc).toBeNull(); // nothing stranded in the events collection
  });
});
