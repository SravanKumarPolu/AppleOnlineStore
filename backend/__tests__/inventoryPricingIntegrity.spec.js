// Phase 4.2/4.4 — Inventory & pricing integrity suite.
//
// E-commerce money-path invariants that MUST hold regardless of client input:
//   P-1  Order totals must be computed from trusted (server-side) product
//        prices, never from client-supplied `items[].price`.
//   P-2  Negative / zero / non-finite prices must be rejected before any DB
//        write (orderItemSchema.price has no `min`, so the schema alone does
//        not stop them).
//   I-1  Placing an order must reserve (decrement) stock for real products.
//   I-2  Stock can never go negative, even when concurrent orders race for
//        the last units (no oversell).
//   I-3  Cancelling an order must restore reserved stock.
//
// Before the fixes, P-1/P-2/I-1/I-2/I-3 fail: the order controller trusted
// `items[].price` verbatim and never touched `stockQuantity`. These tests are
// the executable proof and the permanent regression guard.
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
import productModel from '../models/productModel.js';

let db;
let user;
let userToken;
let product;

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

async function seedProduct(stock = 50, price = 100) {
  return productModel.create({
    name: `iPhone ${Math.random().toString(36).slice(2, 8)}`,
    description: 'Test product',
    price,
    image: ['https://example.com/p.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: 'Black',
    bestseller: false,
    inStock: true,
    stockQuantity: stock,
  });
}

function itemFor(p, overrides = {}) {
  return {
    productId: String(p._id),
    name: p.name,
    image: p.image[0],
    price: p.price,
    quantity: 1,
    color: 'Black',
    ...overrides,
  };
}

const placeOrder = (body) =>
  request(app).post('/api/orders').set('token', userToken).send(body);

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
  product = await seedProduct(50, 100);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('P-1/P-2: server-side pricing integrity (POST /api/orders)', () => {
  it('rejects a tampered (discounted) unit price for a real product — order must use the DB price', async () => {
    const res = await placeOrder({
      items: [itemFor(product, { price: 1 })], // client claims $1 for a $100 product
      address,
      paymentMethod: 'COD',
    });

    if (res.status === 200 || res.status === 201) {
      // If accepted, the persisted total MUST be based on the real price.
      const created = await orderModel.findById(res.body.order?._id);
      expect(Number(created.total)).toBeCloseTo(100 + 10, 2);
    } else {
      // Rejection is also acceptable — but must be a clean 4xx, never a 500.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('rejects negative item prices before any DB write', async () => {
    const before = await orderModel.countDocuments({});
    const res = await placeOrder({
      items: [itemFor(product, { price: -50 })],
      address,
      paymentMethod: 'COD',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const after = await orderModel.countDocuments({});
    expect(after).toBe(before); // nothing persisted
  });

  it('rejects zero-priced items for real products', async () => {
    const res = await placeOrder({
      items: [itemFor(product, { price: 0 })],
      address,
      paymentMethod: 'COD',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('rejects non-finite prices (NaN / Infinity / string) safely', async () => {
    for (const bad of ['not-a-number', NaN, Infinity, -Infinity, null]) {
      const res = await placeOrder({
        items: [itemFor(product, { price: bad })],
        address,
        paymentMethod: 'COD',
      });
      expect([400, 401, 422]).toContain(
        res.status,
        `price=${String(bad)} must yield a 4xx, got ${res.status}`
      );
    }
  });

  it('rejects inflated quantities and non-integer quantities', async () => {
    for (const bad of [0, -1, -100, 1.5, '3', 1e9]) {
      const res = await placeOrder({
        items: [itemFor(product, { quantity: bad })],
        address,
        paymentMethod: 'COD',
      });
      expect([400, 401, 422]).toContain(
        res.status,
        `quantity=${String(bad)} must yield a 4xx, got ${res.status}`
      );
    }
  });
});

describe('I-1/I-3: stock reservation lifecycle', () => {
  it('decrements stockQuantity when an order is placed for a real product', async () => {
    const p = await seedProduct(10, 100);
    const res = await placeOrder({
      items: [itemFor(p, { quantity: 2 })],
      address,
      paymentMethod: 'COD',
    });
    expect(res.status).toBeLessThan(400);

    const fresh = await productModel.findById(p._id);
    expect(fresh.stockQuantity).toBe(8); // 10 - 2
  });

  it('restores stock when an admin cancels the order', async () => {
    const p = await seedProduct(10, 100);
    const placed = await placeOrder({
      items: [itemFor(p, { quantity: 3 })],
      address,
      paymentMethod: 'COD',
    });
    expect(placed.status).toBeLessThan(400);
    const orderId = placed.body.order._id;

    const { makeAdminToken } = await import('./helpers.mjs');
    const adminToken = makeAdminToken();
    const cancel = await request(app)
      .put('/api/orders/status')
      .set('token', adminToken)
      .send({ orderId, status: 'Cancelled' });

    expect(cancel.status).toBeLessThan(400);
    const fresh = await productModel.findById(p._id);
    expect(fresh.stockQuantity).toBe(10); // restored
  });
});

describe('I-2: oversell protection under concurrency', () => {
  it('never lets concurrent orders oversell the last units (stock floor = 0)', async () => {
    const STOCK = 5;
    const p = await seedProduct(STOCK, 100);
    const buyers = Array.from({ length: 12 }, () => createTestUserDoc('user'));

    const users = await Promise.all(buyers);
    const results = await Promise.all(
      users.map((u) =>
        request(app)
          .post('/api/orders')
          .set('token', makeUserToken(u._id))
          .send({
            items: [itemFor(p, { quantity: 1 })],
            address,
            paymentMethod: 'COD',
          })
      )
    );

    const accepted = results.filter((r) => r.status < 400).length;
    const rejected = results.filter((r) => r.status >= 400).length;

    const fresh = await productModel.findById(p._id);
    expect(fresh.stockQuantity).toBeGreaterThanOrEqual(0); // never negative
    expect(fresh.stockQuantity).toBe(Math.max(0, STOCK - accepted));
    expect(accepted).toBeLessThanOrEqual(STOCK); // oversell impossible
    expect(rejected).toBe(users.length - accepted);

    // Every rejected response must be a clean 4xx (not a 500 crash).
    for (const r of results.filter((r) => r.status >= 400)) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
  });

  it('blocks an order whose quantity exceeds available stock (single request)', async () => {
    const p = await seedProduct(3, 100);
    const res = await placeOrder({
      items: [itemFor(p, { quantity: 5 })],
      address,
      paymentMethod: 'COD',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    const fresh = await productModel.findById(p._id);
    expect(fresh.stockQuantity).toBe(3); // untouched
  });

  it('blocks orders for out-of-stock products (stockQuantity = 0)', async () => {
    const p = await seedProduct(0, 100);
    await p.save(); // pre-save flips inStock=false
    const fresh = await productModel.findById(p._id);
    expect(fresh.inStock).toBe(false);

    const res = await placeOrder({
      items: [itemFor(fresh)],
      address,
      paymentMethod: 'COD',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
