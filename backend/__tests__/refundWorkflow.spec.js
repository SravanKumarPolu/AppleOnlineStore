// Refund workflow (POST /api/orders/refund, admin only).
//
// Product decision encoded here: PayPal refunds go through the gateway; COD and
// Card orders are recorded as manual (out-of-band) refunds. Either way the
// order becomes non-refundable-once-only and inventory is restored exactly once.
// The PayPal HTTP edge is mocked via the existing client seam.
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { setPayPalClientForTests } from '../controllers/orderController.js';
import { setActiveWebhookVerifier } from '../services/paypalWebhookService.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import webhookEventModel from '../models/webhookEventModel.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  makeUserToken,
  makeAdminToken,
} from './helpers.mjs';

let db;
let user;
let adminToken;
let shopperToken;

const address = {
  firstName: 'Refund',
  lastName: 'Buyer',
  email: 'refund@example.com',
  street: '1 Refund Road',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '5550100',
};

const makeProduct = () =>
  productModel.create({
    name: `Refund Product ${Math.random().toString(36).slice(2, 7)}`,
    description: 'refund fixture',
    price: 40,
    image: ['https://example.com/refund.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: false,
    date: Date.now(),
    stockQuantity: 10,
    inStock: true,
  });

const makeOrder = async (product, overrides = {}) =>
  orderModel.create({
    userId: user._id,
    items: [
      {
        productId: String(product._id),
        name: product.name,
        image: 'https://example.com/refund.png',
        price: 40,
        quantity: 2,
        color: 'Black',
      },
    ],
    address,
    paymentMethod: 'PayPal',
    subtotal: 80,
    shipping: 10,
    total: 90,
    currency: 'USD',
    paymentStatus: 'completed',
    orderStatus: 'Delivered',
    stockReserved: true,
    paypalOrderId: 'PAYPAL-ORDER-1',
    paypalCaptureId: 'CAPTURE-1',
    ...overrides,
  });

/** PayPal client stub: records the refund request, returns a completed refund. */
function stubRefundClient({ fail = false, error = null, status = 'COMPLETED', id = 'REFUND-1' } = {}) {
  const captured = [];
  return {
    captured,
    async execute(req) {
      captured.push(req);
      if (error) throw error;
      if (fail) throw new Error('gateway down');
      return { result: { id, status } };
    },
  };
}

const refund = (body, token = adminToken) =>
  request(app)
    .post('/api/orders/refund')
    .set('token', token)
    .send(body);

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  adminToken = makeAdminToken('admin@test.local');
  shopperToken = makeUserToken(user._id);
});

afterEach(() => {
  setPayPalClientForTests(null);
  setActiveWebhookVerifier(null);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/orders/refund — authorization and validation', () => {
  it('rejects unauthenticated callers (401) and shoppers (403)', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);

    const anonymous = await request(app).post('/api/orders/refund').send({ orderId: String(order._id) });
    expect(anonymous.status).toBe(401);

    const shopper = await refund({ orderId: String(order._id) }, shopperToken);
    expect(shopper.status).toBe(403);

    expect((await orderModel.findById(order._id)).paymentStatus).toBe('completed');
  });

  it('validates the order id (400 missing / 400 malformed / 404 unknown)', async () => {
    expect((await refund({})).status).toBe(400);
    expect((await refund({ orderId: 'not-an-id' })).status).toBe(400);
    expect((await refund({ orderId: '65f1c2d3e4b5a69788776655' })).status).toBe(404);
  });

  it('refuses to refund an order that was never paid', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product, { paymentStatus: 'pending' });

    const response = await refund({ orderId: String(order._id) });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/completed payment/i);
  });
});

describe('POST /api/orders/refund — PayPal gateway path', () => {
  it('refunds through PayPal, marks the order and restores stock once', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const client = stubRefundClient();
    setPayPalClientForTests(client);

    const response = await refund({ orderId: String(order._id), reason: 'damaged on arrival' });

    expect(response.status).toBe(200);
    expect(response.body.refund).toMatchObject({ id: 'REFUND-1', method: 'paypal', amount: 90 });

    // The gateway request targets the recorded capture and the order amount.
    expect(client.captured).toHaveLength(1);
    expect(String(client.captured[0].path)).toContain('CAPTURE-1');
    expect(client.captured[0].body.amount).toEqual({ value: '90.00', currency_code: 'USD' });

    const updated = await orderModel.findById(order._id);
    expect(updated.paymentStatus).toBe('refunded');
    expect(updated.refundId).toBe('REFUND-1');
    expect(updated.refundMethod).toBe('paypal');
    expect(updated.refundReason).toBe('damaged on arrival');
    expect(updated.stockReserved).toBe(false);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);

    // Idempotent: no second gateway call, no second stock restore.
    const second = await refund({ orderId: String(order._id) });
    expect(second.status).toBe(200);
    expect(second.body.alreadyRefunded).toBe(true);
    expect(client.captured).toHaveLength(1);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);
  });

  it('refuses with 409 (not a second refund) when PayPal already has one pending', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const client = stubRefundClient({ status: 'PENDING' });
    setPayPalClientForTests(client);

    const first = await refund({ orderId: String(order._id) });
    expect(first.status).toBe(202);
    expect(first.body.refund).toMatchObject({ status: 'pending', id: 'REFUND-1' });

    const afterPending = await orderModel.findById(order._id);
    // The money has NOT been returned: the order is not refunded and the
    // reserved units stay held (they are only released on completion).
    expect(afterPending.paymentStatus).toBe('completed');
    expect(afterPending.refundStatus).toBe('pending');
    expect(afterPending.stockReserved).toBe(true);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(10);

    const second = await refund({ orderId: String(order._id) });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('REFUND_PENDING_RECONCILIATION');
    expect(client.captured).toHaveLength(1); // no duplicate gateway refund
    expect((await productModel.findById(product._id)).stockQuantity).toBe(10);
  });

  it('treats a timeout/network failure as indeterminate and never blindly retries', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    // No statusCode/response → the request may have reached PayPal.
    const client = stubRefundClient({ error: new Error('ETIMEDOUT') });
    setPayPalClientForTests(client);

    const response = await refund({ orderId: String(order._id) });
    expect(response.status).toBe(502);
    expect(response.body.reconcilable).toBe(true);

    const afterTimeout = await orderModel.findById(order._id);
    expect(afterTimeout.paymentStatus).toBe('completed');
    expect(afterTimeout.refundStatus).toBe('pending');
    expect(afterTimeout.stockReserved).toBe(true);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(10);

    const retry = await refund({ orderId: String(order._id) });
    expect(retry.status).toBe(409);
    expect(client.captured).toHaveLength(1);
  });

  it('issues exactly one refund for concurrent admin requests', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const client = stubRefundClient();
    setPayPalClientForTests(client);

    const [a, b] = await Promise.all([
      refund({ orderId: String(order._id) }),
      refund({ orderId: String(order._id) }),
    ]);

    expect(client.captured).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);
  });

  it('leaves a definitive PayPal rejection retryable', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const rejection = Object.assign(new Error('422 Unprocessable Entity'), { statusCode: 422 });
    const client = stubRefundClient({ error: rejection });
    setPayPalClientForTests(client);

    const response = await refund({ orderId: String(order._id) });
    expect(response.status).toBe(502);
    expect(response.body.error).toBe('PAYPAL_REFUND_REJECTED');

    const afterRejection = await orderModel.findById(order._id);
    expect(afterRejection.paymentStatus).toBe('completed');
    expect(afterRejection.refundStatus).toBe('failed');
    expect(afterRejection.stockReserved).toBe(true);

    // A definite rejection created no refund: a retry is safe.
    setPayPalClientForTests(stubRefundClient());
    const retry = await refund({ orderId: String(order._id) });
    expect(retry.status).toBe(200);
    expect((await orderModel.findById(order._id)).paymentStatus).toBe('refunded');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);
  });

  it('does not accept an unconfirmed gateway status as a refund', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    setPayPalClientForTests(stubRefundClient({ status: 'FAILED' }));

    const response = await refund({ orderId: String(order._id) });
    expect(response.status).toBe(502);
    expect((await orderModel.findById(order._id)).paymentStatus).toBe('completed');
  });

  it('fails closed when a completed PayPal order has no capture id', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product, { paypalCaptureId: null });
    const client = stubRefundClient();
    setPayPalClientForTests(client);

    const response = await refund({ orderId: String(order._id) });
    expect(response.status).toBe(409);
    expect(client.captured).toHaveLength(0);
    expect((await orderModel.findById(order._id)).paymentStatus).toBe('completed');
  });
});

describe('POST /api/orders/refund — manual (no gateway) path', () => {
  it('records a COD refund without calling PayPal', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product, {
      paymentMethod: 'COD',
      paypalOrderId: null,
      paypalCaptureId: null,
    });
    const client = stubRefundClient();
    setPayPalClientForTests(client);

    const response = await refund({ orderId: String(order._id), reason: 'returned' });

    expect(response.status).toBe(200);
    expect(response.body.refund).toMatchObject({ id: null, method: 'manual' });
    expect(client.captured).toHaveLength(0);

    const updated = await orderModel.findById(order._id);
    expect(updated.paymentStatus).toBe('refunded');
    expect(updated.refundMethod).toBe('manual');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);
  });

  it('rejects a non-string reason', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product, { paymentMethod: 'COD' });

    const response = await refund({ orderId: String(order._id), reason: { evil: true } });
    expect(response.status).toBe(400);
  });
});

describe('refund reconciliation through the signed PayPal webhook', () => {
  const signedHeaders = (req) =>
    req
      .set('paypal-transmission-id', 'tid')
      .set('paypal-transmission-time', new Date().toISOString())
      .set('paypal-cert-url', 'https://example.com/cert')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .set('paypal-transmission-sig', 'sig');

  const refundEvent = (overrides = {}) => ({
    id: `WH-REFUND-${Math.random().toString(36).slice(2, 10)}`,
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: {
      id: 'REFUND-1',
      status: 'COMPLETED',
      amount: { value: '90.00', currency_code: 'USD' },
      links: [
        {
          href: 'https://api.paypal.com/v2/payments/captures/CAPTURE-1/refund',
          rel: 'up',
        },
      ],
      ...overrides,
    },
  });

  it('completes a PENDING refund, restores stock once and ignores duplicates', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const refundId = `REFUND-${Math.random().toString(36).slice(2, 10)}`;
    setPayPalClientForTests(stubRefundClient({ status: 'PENDING', id: refundId }));

    expect((await refund({ orderId: String(order._id) })).status).toBe(202);
    expect((await orderModel.findById(order._id)).refundStatus).toBe('pending');

    setActiveWebhookVerifier({ verify: async () => ({ verified: true }) });

    const first = await signedHeaders(
      request(app).post('/api/orders/paypal/webhook')
    ).send(refundEvent({ id: refundId }));
    expect(first.status).toBe(200);

    const settled = await orderModel.findById(order._id);
    expect(settled.paymentStatus).toBe('refunded');
    expect(settled.refundStatus).toBe('completed');
    expect(settled.stockReserved).toBe(false);
    expect(settled.inventoryRestoration.status).toBe('completed');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);

    // A redelivery (new event id, same refund) must not credit stock again.
    const duplicate = await signedHeaders(
      request(app).post('/api/orders/paypal/webhook')
    ).send(refundEvent({ id: refundId, status: 'COMPLETED' }));
    expect(duplicate.status).toBe(200);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(12);
  });

  it('never applies a refund whose amount does not match the order', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const refundId = `REFUND-${Math.random().toString(36).slice(2, 10)}`;
    setPayPalClientForTests(stubRefundClient({ status: 'PENDING', id: refundId }));
    await refund({ orderId: String(order._id) });

    setActiveWebhookVerifier({ verify: async () => ({ verified: true }) });
    const event = refundEvent({
      id: refundId,
      amount: { value: '45.00', currency_code: 'USD' },
    });

    const response = await signedHeaders(
      request(app).post('/api/orders/paypal/webhook')
    ).send(event);
    expect(response.status).toBe(200);

    const untouched = await orderModel.findById(order._id);
    expect(untouched.paymentStatus).toBe('completed');
    expect(untouched.refundStatus).toBe('pending');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(10);

    const record = await webhookEventModel.findOne({ eventId: event.id }).lean();
    expect(record.result).toBe('refund_amount_currency_mismatch');
    expect(record.status).toBe('unresolved');
  });

  it('records a refund FAILED event as retryable instead of refunded', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    const refundId = `REFUND-${Math.random().toString(36).slice(2, 10)}`;
    setPayPalClientForTests(stubRefundClient({ status: 'PENDING', id: refundId }));
    await refund({ orderId: String(order._id) });

    setActiveWebhookVerifier({ verify: async () => ({ verified: true }) });
    const response = await signedHeaders(
      request(app).post('/api/orders/paypal/webhook')
    ).send(refundEvent({ id: refundId, status: 'FAILED' }));
    expect(response.status).toBe(200);

    const updated = await orderModel.findById(order._id);
    expect(updated.paymentStatus).toBe('completed');
    expect(updated.refundStatus).toBe('failed');
    expect(updated.stockReserved).toBe(true);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(10);
  });
});
