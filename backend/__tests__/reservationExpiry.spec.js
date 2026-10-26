// Inventory-hold expiry for abandoned PayPal checkouts, plus the money-safety
// guard for a capture that arrives after the hold was released.
//
// Before this change a PayPal order reserved stock at creation and NOTHING
// ever released it: an abandoned checkout took the item off sale permanently.
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { setActiveWebhookVerifier } from '../services/paypalWebhookService.js';
import { setPayPalClientForTests } from '../controllers/orderController.js';
import {
  releaseExpiredReservations,
  retryPendingRestorations,
  getReservationTtlMs,
} from '../services/reservationService.js';
import { startTestDb, stopTestDb, createTestUserDoc, makeUserToken } from './helpers.mjs';

let db;
let user;
let userToken;

const address = {
  firstName: 'Hold',
  lastName: 'Owner',
  email: 'hold@example.com',
  street: '1 Hold Street',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '5550100',
};

const makeProduct = (name) =>
  productModel.create({
    name,
    description: 'reservation expiry fixture',
    price: 25,
    image: ['https://example.com/hold.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: false,
    date: Date.now(),
    stockQuantity: 5,
    inStock: true,
  });

const makePayPalOrder = (product, overrides = {}) =>
  orderModel.create({
    userId: user._id,
    items: [
      {
        productId: String(product._id),
        name: product.name,
        image: 'https://example.com/hold.png',
        price: 25,
        quantity: 2,
        color: 'Black',
      },
    ],
    address,
    paymentMethod: 'PayPal',
    subtotal: 50,
    shipping: 10,
    total: 60,
    currency: 'USD',
    paymentStatus: 'pending',
    orderStatus: 'Order Placed',
    stockReserved: true,
    paypalOrderId: `PAYPAL-${Math.random().toString(36).slice(2, 10)}`,
    reservationExpiresAt: new Date(Date.now() - 60_000),
    ...overrides,
  });

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
});

afterAll(async () => {
  setActiveWebhookVerifier(null);
  await stopTestDb(db);
});

describe('reservation expiry', () => {
  it('has a sane, configurable TTL', () => {
    expect(getReservationTtlMs({})).toBe(30 * 60 * 1000);
    expect(getReservationTtlMs({ PAYPAL_RESERVATION_TTL_MS: '900000' })).toBe(900000);
    expect(getReservationTtlMs({ PAYPAL_RESERVATION_TTL_MS: '-5' })).toBe(30 * 60 * 1000);
  });

  it('releases the hold of an expired unpaid PayPal order exactly once', async () => {
    const product = await makeProduct('Expired Hold');
    const order = await makePayPalOrder(product);

    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);

    const released = await releaseExpiredReservations();
    expect(released).toContain(String(order._id));

    const updated = await orderModel.findById(order._id);
    expect(updated.stockReserved).toBe(false);
    expect(updated.orderStatus).toBe('Cancelled');
    expect(updated.paymentStatus).toBe('failed');

    // 2 units returned to the catalog.
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);

    // Second sweep must not restore again.
    await releaseExpiredReservations();
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });

  it('leaves a live (not yet expired) hold untouched', async () => {
    const product = await makeProduct('Live Hold');
    const order = await makePayPalOrder(product, {
      reservationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await releaseExpiredReservations();

    const unchanged = await orderModel.findById(order._id);
    expect(unchanged.stockReserved).toBe(true);
    expect(unchanged.orderStatus).toBe('Order Placed');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);
  });

  it('never touches COD orders or already-paid orders', async () => {
    const product = await makeProduct('Not Applicable');
    const cod = await makePayPalOrder(product, {
      paymentMethod: 'COD',
      reservationExpiresAt: null,
    });
    const paid = await makePayPalOrder(product, { paymentStatus: 'completed' });

    await releaseExpiredReservations();

    expect((await orderModel.findById(cod._id)).stockReserved).toBe(true);
    expect((await orderModel.findById(paid._id)).stockReserved).toBe(true);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);
  });

  it('confirms a capture that arrives AFTER the hold was released instead of re-selling the item', async () => {
    const product = await makeProduct('Late Capture');
    const order = await makePayPalOrder(product);
    await releaseExpiredReservations();

    // The shopper paid late: PayPal delivers PAYMENT.CAPTURE.COMPLETED for the
    // cancelled order. Verify the webhook acknowledges it (no retry storm) but
    // never flips the order back to 'completed'.
    setActiveWebhookVerifier({ verify: async () => ({ verified: true }) });

    const captureId = 'CAPTURE-LATE-1';
    const response = await request(app)
      .post('/api/orders/paypal/webhook')
      .set('paypal-transmission-id', 'tid')
      .set('paypal-transmission-time', new Date().toISOString())
      .set('paypal-cert-url', 'https://example.com/cert')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .set('paypal-transmission-sig', 'sig')
      .send({
        id: `WH-LATE-${Date.now()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: captureId,
          amount: { value: '60.00', currency_code: 'USD' },
          supplementary_data: { related_ids: { order_id: order.paypalOrderId } },
        },
      });

    expect(response.status).toBe(200);

    const afterWebhook = await orderModel.findById(order._id);
    expect(afterWebhook.paymentStatus).toBe('failed'); // NOT silently completed
    expect(afterWebhook.orderStatus).toBe('Cancelled');
    expect(afterWebhook.paypalCaptureId).toBeFalsy();
  });
});

describe('durable inventory restoration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setPayPalClientForTests(null);
    setActiveWebhookVerifier(null);
  });

  it('keeps the obligation when a product credit fails, and retries it', async () => {
    const product = await makeProduct('Credit Failure');
    const order = await makePayPalOrder(product);

    // First credit attempt fails (transient write error).
    const original = productModel.updateOne.bind(productModel);
    let failedOnce = false;
    jest.spyOn(productModel, 'updateOne').mockImplementation((filter, update, options) => {
      if (!failedOnce && String(filter._id) === String(product._id)) {
        failedOnce = true;
        return Promise.reject(new Error('transient write failure'));
      }
      return original(filter, update, options);
    });

    await releaseExpiredReservations();

    const released = await orderModel.findById(order._id);
    expect(released.stockReserved).toBe(false); // claim held
    expect(released.orderStatus).toBe('Cancelled');
    // The units are NOT lost silently: the obligation is recorded and loud.
    expect(released.inventoryRestoration.status).toBe('reconciliation_required');
    expect(released.inventoryRestoration.attempts).toBe(1);
    expect(released.inventoryRestoration.lastError).toMatch(/transient write failure/i);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);

    jest.restoreAllMocks();

    const sweep = await retryPendingRestorations();
    expect(sweep.unresolved).toBe(0);

    const recovered = await orderModel.findById(order._id);
    expect(recovered.inventoryRestoration.status).toBe('completed');
    expect(recovered.inventoryRestoration.completedAt).toBeTruthy();
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);

    // Nothing left to retry, and the item is never credited twice.
    const again = await retryPendingRestorations();
    expect(again.retried).toBe(0);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });

  it('restores each item at most once when only one item fails', async () => {
    const productA = await makeProduct('Multi A');
    const productB = await makeProduct('Multi B');
    const order = await makePayPalOrder(productA, {
      items: [
        {
          productId: String(productA._id),
          name: productA.name,
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 2,
          color: 'Black',
        },
        {
          productId: String(productB._id),
          name: productB.name,
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 1,
          color: 'Black',
        },
      ],
    });

    const original = productModel.updateOne.bind(productModel);
    let failedB = false;
    jest.spyOn(productModel, 'updateOne').mockImplementation((filter, update, options) => {
      if (!failedB && String(filter._id) === String(productB._id)) {
        failedB = true;
        return Promise.reject(new Error('B write failure'));
      }
      return original(filter, update, options);
    });

    await releaseExpiredReservations();
    expect((await productModel.findById(productA._id)).stockQuantity).toBe(7);
    expect((await productModel.findById(productB._id)).stockQuantity).toBe(5);
    expect((await orderModel.findById(order._id)).inventoryRestoration.status).toBe(
      'reconciliation_required'
    );

    jest.restoreAllMocks();
    await retryPendingRestorations();

    // Only B is retried; A keeps its single credit.
    expect((await productModel.findById(productA._id)).stockQuantity).toBe(7);
    expect((await productModel.findById(productB._id)).stockQuantity).toBe(6);
    expect((await orderModel.findById(order._id)).inventoryRestoration.status).toBe('completed');
  });

  it('settles an order whose product no longer exists without failing', async () => {
    const product = await makeProduct('Deleted Product');
    const order = await makePayPalOrder(product, {
      items: [
        {
          productId: String(product._id),
          name: product.name,
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 2,
          color: 'Black',
        },
        {
          productId: '64f1c2d3e4b5a69788776655', // never existed
          name: 'Ghost',
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 1,
          color: 'Black',
        },
      ],
    });

    await releaseExpiredReservations();

    const settled = await orderModel.findById(order._id);
    expect(settled.inventoryRestoration.status).toBe('completed');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });
});

describe('late PayPal capture', () => {
  const captureResult = {
    result: {
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            captures: [
              { id: 'CAPTURE-LATE-99', amount: { value: '60.00', currency_code: 'USD' } },
            ],
          },
        },
      ],
    },
  };

  afterEach(() => {
    setPayPalClientForTests(null);
  });

  it('refuses to capture a cancelled order before calling PayPal', async () => {
    const product = await makeProduct('Cancelled Capture');
    const order = await makePayPalOrder(product);
    await releaseExpiredReservations();

    let gatewayCalls = 0;
    setPayPalClientForTests({
      async execute() {
        gatewayCalls += 1;
        return captureResult;
      },
    });

    const response = await request(app)
      .post('/api/orders/paypal/capture')
      .set('token', userToken)
      .send({ orderID: order.paypalOrderId });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ORDER_NOT_PAYABLE');
    expect(gatewayCalls).toBe(0); // no money is taken for a dead order

    const unchanged = await orderModel.findById(order._id);
    expect(unchanged.paymentStatus).toBe('failed');
    expect(unchanged.orderStatus).toBe('Cancelled');
  });

  it('does not resurrect an order cancelled while the capture was in flight', async () => {
    const product = await makeProduct('In Flight Cancel');
    const order = await makePayPalOrder(product, { reservationExpiresAt: null });

    // Simulate the race: the cancel lands between the pre-flight check and the
    // write that would have marked the order paid.
    setPayPalClientForTests({
      async execute() {
        await orderModel.updateOne(
          { _id: order._id },
          { $set: { orderStatus: 'Cancelled', stockReserved: false } }
        );
        return captureResult;
      },
    });

    const response = await request(app)
      .post('/api/orders/paypal/capture')
      .set('token', userToken)
      .send({ orderID: order.paypalOrderId });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('CAPTURE_REQUIRES_RECONCILIATION');

    const after = await orderModel.findById(order._id);
    expect(after.paymentStatus).toBe('pending'); // NOT silently completed
    expect(after.orderStatus).toBe('Cancelled');
    // The capture reference is recorded so an operator can refund it.
    expect(after.paypalCaptureId).toBe('CAPTURE-LATE-99');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);
  });
});
