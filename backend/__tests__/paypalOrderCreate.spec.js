// Traceability-matrix gap: "PayPal order create (placeOrderPayPal)" had no
// direct spec (only capture + webhook were covered). The PayPal HTTP client
// is swapped via the setPayPalClientForTests seam (the network edge); the
// order math, the STRICT-USD request contract, the DB persistence, and the
// failure branches all execute for real.
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { setPayPalClientForTests } from '../controllers/orderController.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  makeUserToken,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';

let db;
let user;
let userToken;
let product;

// Rebuilt per-test from the SEEDED product: the server now prices orders
// from the products collection (P-1) and discards the client price. The DB
// price is 15, so all amount assertions (30 subtotal / 40 total) are stable.
const item = () => ({
  productId: String(product._id),
  name: 'Test Product',
  image: 'https://example.com/product.png',
  price: 15,
  quantity: 2,
  color: 'Black',
});

const address = {
  firstName: 'Pay',
  lastName: 'Pal',
  email: 'pay@example.com',
  street: '1 Test Street',
  city: 'Test City',
  state: 'TS',
  zipcode: '12345',
  country: 'Testland',
  phone: '5551234567',
};

const APPROVE_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-123';

// Fake PayPal client: captures the real OrdersCreateRequest so the spec can
// assert the exact payload handed to the network edge.
function stubCreateClient() {
  const captured = [];
  const client = {
    captured,
    async execute(request) {
      captured.push(request);
      return {
        result: {
          id: 'PAYPAL-ORDER-123',
          status: 'CREATED',
          links: [{ href: APPROVE_URL, rel: 'approve' }],
        },
      };
    },
  };
  return client;
}

const createRequest = (body) =>
  request(app).post('/api/orders/paypal/create').set('token', userToken).send(body);

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  product = await productModel.create({
    name: 'Test Product',
    description: 'PayPal create fixture product',
    price: 15,
    image: ['https://example.com/product.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: 'Black',
    bestseller: false,
    inStock: true,
    stockQuantity: 1000,
  });
  userToken = makeUserToken(user._id);
});

afterAll(async () => {
  setPayPalClientForTests(null); // reset the seam for other suites
  await stopTestDb(db);
});

describe('POST /api/orders/paypal/create — order creation', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('creates a PayPal order, persists it as pending, and returns the approve link', async () => {
    const client = stubCreateClient();
    setPayPalClientForTests(client);

    const res = await createRequest({ items: [item()], address });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBe('PAYPAL-ORDER-123');
    expect(res.body.links[0]).toEqual({ href: APPROVE_URL, rel: 'approve' });
    expect(res.body.currency).toBe('USD');

    // DB: pending PayPal order with the exact amount math.
    const saved = await orderModel.findById(res.body.dbOrderId);
    expect(saved).toBeTruthy();
    expect(saved.paymentMethod).toBe('PayPal');
    expect(saved.paypalOrderId).toBe('PAYPAL-ORDER-123');
    expect(saved.paymentStatus).toBe('pending');
    expect(saved.orderStatus).toBe('Order Placed');
    expect(saved.subtotal).toBe(30);
    expect(saved.shipping).toBe(10);
    expect(saved.total).toBe(40);
    expect(saved.currency).toBe('USD');

    // The order is linked to the buyer's history.
    const buyer = await userModel.findById(user._id);
    expect(buyer.orders.map(String)).toContain(String(saved._id));
  });

  it('sends a STRICT-USD CAPTURE request to the PayPal network edge', async () => {
    const client = stubCreateClient();
    setPayPalClientForTests(client);

    const res = await createRequest({ items: [item()], address });
    expect(res.status).toBe(200);
    expect(client.captured).toHaveLength(1);

    const body = client.captured[0].body;
    expect(body.intent).toBe('CAPTURE');
    const unit = body.purchase_units[0];
    expect(unit.amount).toEqual({
      currency_code: 'USD',
      value: '40.00',
      breakdown: {
        item_total: { currency_code: 'USD', value: '30.00' },
        shipping: { currency_code: 'USD', value: '10.00' },
      },
    });
    expect(unit.items[0]).toMatchObject({
      name: 'Test Product',
      unit_amount: { currency_code: 'USD', value: '15.00' },
      quantity: '2',
      category: 'PHYSICAL_GOODS',
    });
    expect(body.application_context.shipping_preference).toBe('SET_PROVIDED_ADDRESS');
    // The US shipping address is forced for PayPal compatibility.
    expect(unit.shipping.address.country_code).toBe('US');
    // Brand comes from APP_NAME (no legacy product name baked into the SDK call).
    expect(body.application_context.brand_name).toBe('NovaCart');
    // No payee pin by default: PayPal routes to the credential-owning account.
    expect(unit.payee).toBeUndefined();
  });

  it('only sends a payee when PAYPAL_PAYEE_EMAIL is configured', async () => {
    const client = stubCreateClient();
    setPayPalClientForTests(client);

    const previous = process.env.PAYPAL_PAYEE_EMAIL;
    process.env.PAYPAL_PAYEE_EMAIL = 'merchant@novacart.test.example';
    try {
      const res = await createRequest({ items: [item()], address });
      expect(res.status).toBe(200);
      expect(client.captured[0].body.purchase_units[0].payee).toEqual({
        email_address: 'merchant@novacart.test.example',
      });
    } finally {
      if (previous === undefined) delete process.env.PAYPAL_PAYEE_EMAIL;
      else process.env.PAYPAL_PAYEE_EMAIL = previous;
    }
  });

  it('rejects unauthenticated order creation with 401', async () => {
    setPayPalClientForTests(stubCreateClient());

    const res = await request(app)
      .post('/api/orders/paypal/create')
      .send({ items: [item()], address });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a request missing items or address with 400', async () => {
    setPayPalClientForTests(stubCreateClient());

    const missingItems = await createRequest({ address });
    expect(missingItems.status).toBe(400);
    expect(missingItems.body.message).toMatch(/items and address are required/i);

    const missingAddress = await createRequest({ items: [item()] });
    expect(missingAddress.status).toBe(400);
  });

  it('maps a PayPal currency error to 400 CURRENCY_NOT_SUPPORTED and persists nothing', async () => {
    setPayPalClientForTests({
      async execute() {
        throw {
          response: {
            status: 400,
            data: { details: [{ issue: 'CURRENCY_NOT_SUPPORTED_FOR_API' }] },
          },
          message: 'currency not supported',
        };
      },
    });

    const before = await orderModel.countDocuments();
    const res = await createRequest({ items: [item()], address });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CURRENCY_NOT_SUPPORTED');
    expect(res.body.message).toMatch(/currency/i);
    expect(await orderModel.countDocuments()).toBe(before);
  });

  it('maps a generic PayPal outage to 500 PAYPAL_UNAVAILABLE and persists nothing', async () => {
    setPayPalClientForTests({
      async execute() {
        throw new Error('connection reset by peer');
      },
    });

    const before = await orderModel.countDocuments();
    const res = await createRequest({ items: [item()], address });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('PAYPAL_UNAVAILABLE');
    expect(res.body.success).toBe(false);
    expect(await orderModel.countDocuments()).toBe(before);
  });
});
