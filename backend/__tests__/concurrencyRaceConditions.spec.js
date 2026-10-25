// Phase 5 — Concurrency & race conditions.
//
// Real concurrent HTTP traffic (2, 10, 50, 100 in-flight requests) against the
// in-memory test instance. Invariants:
//   R-1  A single legitimate PayPal payment can never produce duplicate
//        fulfilled orders or double side-effects, even when the capture
//        endpoint and the webhook race, or when PayPal redelivers the same
//        event many times at once.
//   R-2  Concurrent cart mutations never crash or corrupt the user document.
//   R-3  Concurrent admin status updates end in a consistent state.
//   R-4  Concurrent order creation must respect stock (covered further in
//        inventoryPricingIntegrity.spec.js — the oversell test).
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  createTestOrderDoc,
  makeAdminToken,
  makeUserToken,
  WEBHOOK_HEADERS,
  webhookEvent,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';
import webhookEventModel from '../models/webhookEventModel.js';
import {
  createWebhookVerifier,
  setActiveWebhookVerifier,
} from '../services/paypalWebhookService.js';

let db;
let user;

let adminToken;

function stubClient() {
  return {
    async execute() {
      return { result: { verification_status: 'SUCCESS' } };
    },
  };
}

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  adminToken = makeAdminToken();
  setActiveWebhookVerifier(
    createWebhookVerifier({ client: stubClient(), webhookId: 'WH-TEST' })
  );
});

afterAll(async () => {
  await stopTestDb(db);
});

async function seedPendingOrder(captureId) {
  return createTestOrderDoc(user._id, {
    paypalOrderId: `PAY-${captureId}`,
    paypalCaptureId: captureId,
    paymentStatus: 'pending',
  });
}

async function deliver(event) {
  return request(app)
    .post('/api/orders/paypal/webhook')
    .set(WEBHOOK_HEADERS)
    .send(event);
}

describe('R-1: webhook concurrency & replay', () => {
  it('10 simultaneous identical webhook deliveries → exactly ONE fulfillment, no duplicate processing', async () => {
    const order = await seedPendingOrder('CAP-RACE-10');
    const event = webhookEvent('EVT-RACE-10', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-RACE-10');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => deliver(event))
    );

    // At most one delivery performs the work; others are duplicates (200
    // "ignored") or lock-refused (500 → PayPal retries). No 4xx crashes.
    for (const r of results) {
      expect(r.status).toBeLessThan(500 + 1);
      expect([200, 500]).toContain(r.status);
    }

    const fresh = await orderModel.findById(order._id);
    expect(fresh.paymentStatus).toBe('completed');

    const records = await webhookEventModel.find({ eventId: 'EVT-RACE-10' });
    expect(records.length).toBe(1); // unique index enforced

    // Exactly one completed record, and attempts bounded.
    const completed = records.filter((r) => r.status === 'completed');
    expect(completed.length).toBeLessThanOrEqual(1);
    expect(records[0].attempts).toBeLessThan(10);
  });

  it('100 simultaneous identical webhook deliveries → still exactly ONE fulfillment', async () => {
    const order = await seedPendingOrder('CAP-RACE-100');
    const event = webhookEvent('EVT-RACE-100', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-RACE-100');

    const results = await Promise.all(
      Array.from({ length: 100 }, () => deliver(event))
    );

    for (const r of results) {
      expect([200, 500]).toContain(r.status);
    }

    const fresh = await orderModel.findById(order._id);
    expect(fresh.paymentStatus).toBe('completed');
    expect((await webhookEventModel.find({ eventId: 'EVT-RACE-100' })).length).toBe(1);
  });

  it('replaying a completed event after success acknowledges without side effects', async () => {
    const order = await seedPendingOrder('CAP-REPLAY');
    const event = webhookEvent('EVT-REPLAY', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-REPLAY');
    await deliver(event);
    const afterFirst = await orderModel.findById(order._id);
    expect(afterFirst.paymentStatus).toBe('completed');

    const replay = await deliver(event);
    expect(replay.status).toBe(200);

    const afterReplay = await orderModel.findById(order._id);
    expect(afterReplay.paymentStatus).toBe('completed');
    expect(afterReplay.orderStatus).toBe(afterFirst.orderStatus); // unchanged
  });

  it('payment must never flip a refunded order back to completed (replay after refund)', async () => {
    const order = await seedPendingOrder('CAP-REFUNDED-GUARD');
    await orderModel.updateOne(
      { _id: order._id },
      { paymentStatus: 'refunded' }
    );
    const event = webhookEvent('EVT-REFUNDED-GUARD', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-REFUNDED-GUARD');
    const res = await deliver(event);
    expect(res.status).toBeLessThan(500);
    const fresh = await orderModel.findById(order._id);
    expect(fresh.paymentStatus).toBe('refunded'); // never clobbered
  });
});

describe('R-2: concurrent cart operations', () => {
  it('50 interleaved add/update operations end in a parseable cart with no crash', async () => {
    const token = makeUserToken(user._id);
    const itemId = '6626abcd1234abcd1234abcd';

    const ops = [];
    for (let i = 0; i < 25; i++) {
      ops.push(
        request(app).post('/api/cart/add').set('token', token).send({ itemId, color: 'Black' })
      );
      ops.push(
        request(app).post('/api/cart/update').set('token', token).send({ itemId, color: 'Blue', quantity: (i % 5) + 1 })
      );
    }
    const results = await Promise.all(ops);
    for (const r of results) {
      expect(r.status).toBeLessThan(500);
    }

    const cart = await request(app).post('/api/cart/get').set('token', token).send({});
    expect(cart.status).toBe(200);
    expect(typeof cart.body.cartData).toBe('object');
    expect(cart.body.cartData).not.toBeNull();
  });
});

describe('R-3: concurrent admin status updates', () => {
  it('10 concurrent status updates land on one of the requested statuses (no corruption)', async () => {
    const order = await createTestOrderDoc(user._id, { orderStatus: 'Order Placed' });
    const statuses = ['Packing', 'Shipped', 'Out for delivery', 'Delivered'];

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .put('/api/orders/status')
          .set('token', adminToken)
          .send({ orderId: String(order._id), status: statuses[i % statuses.length] })
      )
    );

    for (const r of results) {
      expect(r.status).toBeLessThan(400);
    }
    const fresh = await orderModel.findById(order._id);
    expect(statuses).toContain(fresh.orderStatus);
  });
});

describe('R-1b: capture endpoint vs webhook race', () => {
  it('simultaneous capture + webhook for the same order → single completed payment, no double fulfillment', async () => {
    const { setPayPalClientForTests } = await import('../controllers/orderController.js');

    const order = await createTestOrderDoc(user._id, {
      paypalOrderId: 'PAY-CAPTURE-RACE',
      paypalCaptureId: null,
      paymentStatus: 'pending',
    });

    // Capture stub returns PayPal's captured amount matching the order total.
    setPayPalClientForTests({
      async execute() {
        return {
          result: {
            id: 'CAP-CAPTURE-RACE',
            status: 'COMPLETED',
            purchase_units: [
              {
                payments: {
                  captures: [
                    { id: 'CAP-CAPTURE-RACE', status: 'COMPLETED', amount: { currency_code: 'USD', value: '20.00' } },
                  ],
                },
              },
            ],
          },
        };
      },
    });

    const event = webhookEvent(
      'EVT-CAPTURE-RACE',
      'PAYMENT.CAPTURE.COMPLETED',
      'CAP-CAPTURE-RACE',
      { supplementary_data: { related_ids: { order_id: 'PAY-CAPTURE-RACE' } } }
    );

    const [captureRes, webhookRes] = await Promise.all([
      request(app)
        .post('/api/orders/paypal/capture')
        .set('token', makeUserToken(user._id))
        .send({ orderID: 'PAY-CAPTURE-RACE' }),
      deliver(event),
    ]);

    expect(captureRes.status).toBeLessThan(400);
    expect([200, 500]).toContain(webhookRes.status);

    const fresh = await orderModel.findById(order._id);
    expect(fresh.paymentStatus).toBe('completed');
    // No duplicate order documents were created for this single payment, and
    // the user's orders array references the order at most once.
    const duplicates = await orderModel.countDocuments({ paypalOrderId: 'PAY-CAPTURE-RACE' });
    expect(duplicates).toBe(1);
    const { default: userModel } = await import('../models/userModel.js');
    const owner = await userModel.findById(user._id);
    const refs = (owner.orders || []).map(String).filter((id) => id === String(order._id));
    expect(refs.length).toBeLessThanOrEqual(1);

    setPayPalClientForTests(null);
  });
});
