// Refund workflow (POST /api/orders/refund, admin only).
//
// Product decision encoded here: PayPal refunds go through the gateway; COD and
// Card orders are recorded as manual (out-of-band) refunds. Either way the
// order becomes non-refundable-once-only and inventory is restored exactly once.
// The PayPal HTTP edge is mocked via the existing client seam.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { setPayPalClientForTests } from '../controllers/orderController.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
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
function stubRefundClient({ fail = false, status = 'COMPLETED', id = 'REFUND-1' } = {}) {
  const captured = [];
  return {
    captured,
    async execute(req) {
      captured.push(req);
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

  it('leaves the order untouched when PayPal rejects the refund', async () => {
    const product = await makeProduct();
    const order = await makeOrder(product);
    setPayPalClientForTests(stubRefundClient({ fail: true }));

    const response = await refund({ orderId: String(order._id) });
    expect(response.status).toBe(502);

    const unchanged = await orderModel.findById(order._id);
    expect(unchanged.paymentStatus).toBe('completed');
    expect(unchanged.stockReserved).toBe(true);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(10);
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
