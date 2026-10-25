// Final gate Task 6 — safe handling of unmatched PayPal captures.
//
// The regression this suite pins down: PAYMENT.CAPTURE.COMPLETED events with
// no matching order used to be recorded as 'no_matching_order', marked
// 'completed' and acknowledged (HTTP 200). If the order row appeared later,
// PayPal never redelivered and the order kept paymentStatus 'pending'
// forever. Now such events are left 'unresolved' and retried within a bounded
// budget, reconciled safely when the order appears, verified for
// amount/currency/identity before any order write, and alerted on when the
// budget is exhausted.
//
// The ONLY stub is the PayPal verification client (network edge); every
// decision (acquisition, reconciliation, verification, budgeting, alerting)
// executes for real against an in-memory MongoDB.
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
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
let userId;

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
async function seedEventDoc({ eventId, status, result, attempts = 1, resourceId = 'CAP-SEEDED' }) {
  const now = Date.now();
  await webhookEventModel.collection.insertOne({
    eventId,
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    resourceId,
    status,
    result: result ?? null,
    attempts,
    lastError: null,
    completedAt: null,
    processedAt: new Date(now - 3600_000),
    createdAt: new Date(now - 7200_000),
    updatedAt: new Date(now - 3600_000),
    __v: 0,
  });
}

async function getEventDoc(eventId) {
  return webhookEventModel.findOne({ eventId }).lean();
}

function captureAlertCalls(spy, reason) {
  return spy.mock.calls.filter((args) =>
    args.some((arg) => String(arg).includes('PAYMENT WEBHOOK ALERT') && String(arg).includes(reason))
  );
}

beforeAll(async () => {
  db = await startTestDb();
  const user = await createTestUserDoc('user');
  userId = user._id;
});

afterAll(async () => {
  clearActiveWebhookVerifier();
  await stopTestDb(db);
});

describe('POST /api/orders/paypal/webhook — unmatched & delayed-order captures', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('defers an unmatched capture (500 + unresolved) instead of acknowledging it', async () => {
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(
        webhookEvent('WH-EVT-UNMATCHED', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-UNMATCHED-1', {
          supplementary_data: { related_ids: { order_id: 'PAY-UNMATCHED-1' } },
        })
      );

    // 500 asks PayPal to redeliver — delayed order creation is still possible.
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);

    const doc = await getEventDoc('WH-EVT-UNMATCHED');
    expect(doc.status).toBe('unresolved');
    expect(doc.result).toBe('no_matching_order');
    expect(doc.attempts).toBe(1);
    expect(doc.lastError).toContain('CAP-UNMATCHED-1');
  });

  it('DELAYED ORDER CREATION: a redelivery reconciles the late order safely', async () => {
    activateVerifier();
    const event = webhookEvent('WH-EVT-DELAYED', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-DELAYED-1', {
      supplementary_data: { related_ids: { order_id: 'PAY-DELAYED-1' } },
    });

    // 1st delivery — no order exists yet: deferred, not lost.
    const first = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(event);
    expect(first.status).toBe(500);

    // The order row appears late (capture endpoint crashed before its DB
    // write, replication lag, etc.) — still pending, no capture id recorded.
    await createTestOrderDoc(userId, {
      paypalOrderId: 'PAY-DELAYED-1',
      paymentStatus: 'pending',
    });

    // PayPal redelivers the SAME event: reconciliation must find the order by
    // the PayPal order id carried in the signed payload, verify amount +
    // currency, and only then complete it.
    const second = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(event);

    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);

    const order = await orderModel.findOne({ paypalOrderId: 'PAY-DELAYED-1' });
    expect(order.paymentStatus).toBe('completed');
    expect(order.paypalCaptureId).toBe('CAP-DELAYED-1');
    expect(order.paypalTransactionId).toBe('CAP-DELAYED-1');

    const doc = await getEventDoc('WH-EVT-DELAYED');
    expect(doc.status).toBe('completed');
    expect(doc.result).toBe('order_updated_reconciled');
    expect(doc.attempts).toBe(2);
  });

  it('BOUNDED RETRY: acknowledges terminally + alerts once the budget is spent', async () => {
    const previousBudget = process.env.WEBHOOK_MAX_UNMATCHED_ATTEMPTS;
    process.env.WEBHOOK_MAX_UNMATCHED_ATTEMPTS = '2';
    try {
      activateVerifier();
      // Simulate the event already having consumed its budget (attempts = 2).
      await seedEventDoc({
        eventId: 'WH-EVT-EXHAUSTED',
        status: 'unresolved',
        result: 'no_matching_order',
        attempts: 2,
        resourceId: 'CAP-EXHAUSTED-1',
      });

      const res = await request(app)
        .post('/api/orders/paypal/webhook')
        .set(WEBHOOK_HEADERS)
        .send(
          webhookEvent('WH-EVT-EXHAUSTED', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-EXHAUSTED-1', {
            supplementary_data: { related_ids: { order_id: 'PAY-EXHAUSTED-1' } },
          })
        );

      // Budget spent: acknowledge (stop the retry storm) but leave a terminal
      // unresolved record + an ops alert for manual reconciliation.
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const doc = await getEventDoc('WH-EVT-EXHAUSTED');
      expect(doc.status).toBe('unresolved');
      expect(doc.result).toBe('no_matching_order_retry_exhausted');
      expect(doc.attempts).toBe(3); // re-acquisition incremented

      // The alert fired exactly once with the right reason.
      const alerts = captureAlertCalls(consoleErrorSpy, 'no_matching_order_retry_exhausted');
      expect(alerts.length).toBe(1);
      expect(String(alerts[0])).toContain('CAP-EXHAUSTED-1');
    } finally {
      if (previousBudget === undefined) delete process.env.WEBHOOK_MAX_UNMATCHED_ATTEMPTS;
      else process.env.WEBHOOK_MAX_UNMATCHED_ATTEMPTS = previousBudget;
    }
  });

  it('AMOUNT VERIFICATION: a capture whose amount differs from the order is never applied', async () => {
    activateVerifier();
    const order = await createTestOrderDoc(userId, {
      paypalCaptureId: 'CAP-AMOUNT-X',
      paymentStatus: 'pending',
    });

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(
        webhookEvent('WH-EVT-AMOUNT-X', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-AMOUNT-X', {
          amount: { currency_code: 'USD', value: '999.00' },
        })
      );

    // Deterministic mismatch: acknowledged so PayPal stops retrying, but the
    // order is untouched and the event is flagged for review.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const untouched = await orderModel.findById(order._id);
    expect(untouched.paymentStatus).toBe('pending');

    const doc = await getEventDoc('WH-EVT-AMOUNT-X');
    expect(doc.status).toBe('unresolved');
    expect(doc.result).toBe('amount_currency_mismatch');
    expect(captureAlertCalls(consoleErrorSpy, 'amount_currency_mismatch').length).toBe(1);
  });

  it('CURRENCY VERIFICATION: a capture in the wrong currency is never applied', async () => {
    activateVerifier();
    const order = await createTestOrderDoc(userId, {
      paypalCaptureId: 'CAP-CURRENCY-X',
      paymentStatus: 'pending',
    });

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(
        webhookEvent('WH-EVT-CURRENCY-X', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-CURRENCY-X', {
          amount: { currency_code: 'EUR', value: '20.00' },
        })
      );

    expect(res.status).toBe(200);

    const untouched = await orderModel.findById(order._id);
    expect(untouched.paymentStatus).toBe('pending');

    const doc = await getEventDoc('WH-EVT-CURRENCY-X');
    expect(doc.status).toBe('unresolved');
    expect(doc.result).toBe('amount_currency_mismatch');
    expect(captureAlertCalls(consoleErrorSpy, 'amount_currency_mismatch').length).toBe(1);
  });

  it('IDENTITY VERIFICATION: a capture from a different PayPal order is never grafted', async () => {
    activateVerifier();
    // Order A was already completed and recorded ITS capture (CAP-A).
    const orderA = await createTestOrderDoc(userId, {
      paypalOrderId: 'PAY-ORDER-A',
      paypalCaptureId: 'CAP-A',
      paymentStatus: 'completed',
    });

    // A verified event for capture CAP-B claims to relate to PAY-ORDER-A.
    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(
        webhookEvent('WH-EVT-GRAFT', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-B', {
          supplementary_data: { related_ids: { order_id: 'PAY-ORDER-A' } },
        })
      );

    expect(res.status).toBe(200);

    const untouched = await orderModel.findById(orderA._id);
    expect(untouched.paymentStatus).toBe('completed');
    expect(untouched.paypalCaptureId).toBe('CAP-A'); // not overwritten by CAP-B

    const doc = await getEventDoc('WH-EVT-GRAFT');
    expect(doc.status).toBe('unresolved');
    expect(doc.result).toBe('capture_order_mismatch');
    expect(captureAlertCalls(consoleErrorSpy, 'capture_order_mismatch').length).toBe(1);
  });

  it('never clobbers a refunded order back to completed', async () => {
    activateVerifier();
    const order = await createTestOrderDoc(userId, {
      paypalCaptureId: 'CAP-REFUNDED',
      paymentStatus: 'refunded',
    });

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(webhookEvent('WH-EVT-REFUNDED', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-REFUNDED'));

    expect(res.status).toBe(200);

    const untouched = await orderModel.findById(order._id);
    expect(untouched.paymentStatus).toBe('refunded'); // stays refunded

    const doc = await getEventDoc('WH-EVT-REFUNDED');
    expect(doc.status).toBe('completed'); // event resolved — effect already realized
    expect(doc.result).toBe('order_updated');
  });

  it('rejects a malformed capture amount BEFORE writing any event record', async () => {
    activateVerifier();

    const res = await request(app)
      .post('/api/orders/paypal/webhook')
      .set(WEBHOOK_HEADERS)
      .send(
        webhookEvent('WH-EVT-BAD-AMOUNT', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-BAD-AMOUNT', {
          amount: { currency_code: 'USD', value: 'not-a-number' },
        })
      );

    expect(res.status).toBe(400);
    expect(await getEventDoc('WH-EVT-BAD-AMOUNT')).toBeNull();
  });
});
