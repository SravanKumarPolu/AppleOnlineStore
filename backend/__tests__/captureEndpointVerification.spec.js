// Final gate Task 6 — capture-endpoint hardening.
//
// The PayPal HTTP client is swapped via the setPayPalClientForTests seam (the
// network edge). Everything else — order lookup, captured amount/currency
// verification against the expected payment, order update, cart clearing,
// and the webhook reconciliation sweep for events that arrived during the
// capture request — executes for real against an in-memory MongoDB.
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { setPayPalClientForTests } from '../controllers/orderController.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  createTestOrderDoc,
  makeUserToken,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';
import webhookEventModel from '../models/webhookEventModel.js';

let db;
let userId;
let token;

function stubCaptureClient(captureId, amount = '20.00', currency = 'USD') {
  return {
    async execute() {
      return {
        result: {
          status: 'COMPLETED',
          purchase_units: [
            {
              payments: {
                captures: [{ id: captureId, amount: { currency_code: currency, value: amount } }],
              },
            },
          ],
        },
      };
    },
  };
}

async function seedUnresolvedEvent({ eventId, resourceId }) {
  await webhookEventModel.collection.insertOne({
    eventId,
    eventType: 'PAYMENT.CAPTURE.COMPLETED',
    resourceId,
    status: 'unresolved',
    result: 'no_matching_order',
    attempts: 1,
    lastError: 'no order matched capture (awaiting retry)',
    completedAt: null,
    processedAt: new Date(Date.now() - 1800_000),
    createdAt: new Date(Date.now() - 3600_000),
    updatedAt: new Date(Date.now() - 1800_000),
    __v: 0,
  });
}

beforeAll(async () => {
  db = await startTestDb();
  const user = await createTestUserDoc('user');
  userId = user._id;
  token = makeUserToken(String(userId));
});

afterAll(async () => {
  setPayPalClientForTests(null); // reset the seam for other suites in this worker
  await stopTestDb(db);
});

describe('POST /api/orders/paypal/capture — expected-payment verification + webhook sweep', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('completes the order when the captured amount/currency match the expected payment', async () => {
    const order = await createTestOrderDoc(userId, {
      paypalOrderId: 'PAY-OK-1',
      paymentStatus: 'pending',
    });
    setPayPalClientForTests(stubCaptureClient('CAP-OK-1'));

    const res = await request(app)
      .post('/api/orders/paypal/capture')
      .set({ token })
      .send({ orderID: 'PAY-OK-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.captureDetails.captureId).toBe('CAP-OK-1');

    const updated = await orderModel.findById(order._id);
    expect(updated.paymentStatus).toBe('completed');
    expect(updated.paypalCaptureId).toBe('CAP-OK-1');
    expect(updated.paypalTransactionId).toBe('CAP-OK-1');
  });

  it('AMOUNT MISMATCH: never marks the order paid when the captured amount differs', async () => {
    const order = await createTestOrderDoc(userId, {
      paypalOrderId: 'PAY-AMT-X',
      paymentStatus: 'pending',
    });
    setPayPalClientForTests(stubCaptureClient('CAP-AMT-X', '999.00'));

    const res = await request(app)
      .post('/api/orders/paypal/capture')
      .set({ token })
      .send({ orderID: 'PAY-AMT-X' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);

    const untouched = await orderModel.findById(order._id);
    expect(untouched.paymentStatus).toBe('pending');
    expect(untouched.paypalCaptureId).toBeFalsy();

    const alerted = consoleErrorSpy.mock.calls.some((args) =>
      args.some((arg) => String(arg).includes('capture_amount_mismatch'))
    );
    expect(alerted).toBe(true);
  });

  it('CURRENCY MISMATCH: never marks the order paid when the captured currency differs', async () => {
    const order = await createTestOrderDoc(userId, {
      paypalOrderId: 'PAY-CUR-X',
      paymentStatus: 'pending',
    });
    setPayPalClientForTests(stubCaptureClient('CAP-CUR-X', '20.00', 'EUR'));

    const res = await request(app)
      .post('/api/orders/paypal/capture')
      .set({ token })
      .send({ orderID: 'PAY-CUR-X' });

    expect(res.status).toBe(409);

    const untouched = await orderModel.findById(order._id);
    expect(untouched.paymentStatus).toBe('pending');
  });

  it('RECONCILIATION SWEEP: closes unresolved webhook events for the capture it just applied', async () => {
    // Webhook for CAP-SWEEP-1 arrived while this capture request was in
    // flight — it found no capture id on the order and was deferred as
    // 'unresolved' awaiting a PayPal retry.
    await seedUnresolvedEvent({ eventId: 'WH-EVT-SWEEP', resourceId: 'CAP-SWEEP-1' });
    // A second event flagged for a different capture must remain untouched.
    await seedUnresolvedEvent({ eventId: 'WH-EVT-SWEEP-OTHER', resourceId: 'CAP-OTHER-9' });

    await createTestOrderDoc(userId, {
      paypalOrderId: 'PAY-SWEEP-1',
      paymentStatus: 'pending',
    });
    setPayPalClientForTests(stubCaptureClient('CAP-SWEEP-1'));

    const res = await request(app)
      .post('/api/orders/paypal/capture')
      .set({ token })
      .send({ orderID: 'PAY-SWEEP-1' });

    expect(res.status).toBe(200);

    // The racy webhook event is reconciled: its effect was realized by this
    // trusted API response, so no retry / alert is needed for it.
    const swept = await webhookEventModel.findOne({ eventId: 'WH-EVT-SWEEP' }).lean();
    expect(swept.status).toBe('completed');
    expect(swept.result).toBe('order_updated');

    // Unrelated events are left for their own reconciliation path.
    const other = await webhookEventModel.findOne({ eventId: 'WH-EVT-SWEEP-OTHER' }).lean();
    expect(other.status).toBe('unresolved');
  });
});
