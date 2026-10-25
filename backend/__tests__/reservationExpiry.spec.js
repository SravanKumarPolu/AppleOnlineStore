// Inventory-hold expiry for abandoned PayPal checkouts, plus the money-safety
// guard for a capture that arrives after the hold was released.
//
// Before this change a PayPal order reserved stock at creation and NOTHING
// ever released it: an abandoned checkout took the item off sale permanently.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';
import { setActiveWebhookVerifier } from '../services/paypalWebhookService.js';
import { releaseExpiredReservations, getReservationTtlMs } from '../services/reservationService.js';
import { startTestDb, stopTestDb, createTestUserDoc } from './helpers.mjs';

let db;
let user;

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
