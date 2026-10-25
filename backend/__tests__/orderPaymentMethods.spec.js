// K-1 fix regression suite — COD and Card checkout must create real orders
// through the generic order endpoint (POST /api/orders), and only whitelisted
// payment methods are accepted. Before the fix the storefront's COD/Card
// branch only showed a success toast and nothing was persisted.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeUserToken,
  createTestUserDoc,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import productModel from '../models/productModel.js';

let db;
let user;
let userToken;
let product;

// Item fixture is rebuilt per-test from the SEEDED product so the server-side
// pricing (P-1) sees a real catalog row. The client price of 10 is IGNORED by
// the server (which uses the DB price of 10) — totals stay 20+10=30.
const item = () => ({
  productId: String(product._id),
  name: 'Test Product',
  image: 'https://example.com/product.png',
  price: 10,
  quantity: 2,
  color: 'Black',
});

const address = {
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  street: '1 Test Street',
  city: 'Test City',
  state: 'TS',
  zipcode: '12345',
  country: 'Testland',
  phone: '5551234567',
};

const placeOrderRequest = (body) =>
  request(app).post('/api/orders').set('token', userToken).send(body);

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
  product = await productModel.create({
    name: 'Test Product',
    description: 'K-1 fixture product',
    price: 10,
    image: ['https://example.com/product.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: 'Black',
    bestseller: false,
    inStock: true,
    stockQuantity: 1000,
  });
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/orders — COD/Card order creation (K-1 fix)', () => {
  it('creates and persists a real COD order with paymentStatus pending', async () => {
    const res = await placeOrderRequest({
      items: [item()],
      address,
      paymentMethod: 'COD',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.paymentMethod).toBe('COD');
    expect(res.body.order.paymentStatus).toBe('pending');
    expect(res.body.order.orderStatus).toBe('Order Placed');
    expect(res.body.order.subtotal).toBe(20);
    expect(res.body.order.shipping).toBe(10);
    expect(res.body.order.total).toBe(30);

    const saved = await orderModel.findById(res.body.order._id);
    expect(saved).toBeTruthy();
    expect(saved.paymentMethod).toBe('COD');
    expect(saved.paymentStatus).toBe('pending');
    expect(saved.currency).toBe('USD');
  });

  it('creates and persists a real Card order with paymentStatus pending', async () => {
    const res = await placeOrderRequest({
      items: [item()],
      address,
      paymentMethod: 'Card',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.paymentMethod).toBe('Card');
    expect(res.body.order.paymentStatus).toBe('pending');

    const saved = await orderModel.findById(res.body.order._id);
    expect(saved).toBeTruthy();
    expect(saved.paymentMethod).toBe('Card');
    expect(saved.paymentStatus).toBe('pending');
  });

  it('clears the server-side cart and links the order to the user', async () => {
    // Pre-seed the user's cart so the clear is observable.
    await userModel.findByIdAndUpdate(user._id, {
      cartData: { [String(product._id)]: { Black: 2 } },
    });

    const res = await placeOrderRequest({
      items: [item()],
      address,
      paymentMethod: 'COD',
    });
    expect(res.status).toBe(200);

    const after = await userModel.findById(user._id);
    expect(after.cartData).toEqual({});
    expect(after.orders.map(String)).toContain(String(res.body.order._id));
  });

  it.each(['stripe', 'cod', 'Paypal'])(
    'rejects a non-whitelisted payment method (%s) with a 400',
    async (badMethod) => {
      const res = await placeOrderRequest({
        items: [item()],
        address,
        paymentMethod: badMethod,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid payment method/);

      // Nothing may be persisted for a rejected method.
      const count = await orderModel.countDocuments({ paymentMethod: badMethod });
      expect(count).toBe(0);
    }
  );

  it('still rejects unauthenticated order creation with 401', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ items: [item()], address, paymentMethod: 'COD' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
