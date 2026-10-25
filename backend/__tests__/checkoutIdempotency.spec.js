// Coverage-gap: the checkout Idempotency-Key replay path (orderController
// AF-1 block + the unique {userId, idempotencyKey} partial index) had NO
// spec — no test anywhere sent the header. These specs pin the money-path
// invariant: a retried/double-submitted checkout carrying the same key
// creates and stock-reserves EXACTLY ONE order. The legacy no-header path
// (two orders) stays pinned by businessLogicCartCheckout.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeUserToken,
  createTestUserDoc,
} from './helpers.mjs';
import productModel from '../models/productModel.js';
import orderModel from '../models/orderModel.js';

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

const orderBody = () => ({
  items: [
    {
      productId: String(product._id),
      name: product.name,
      image: product.image[0],
      price: product.price,
      quantity: 1,
      color: 'Black',
    },
  ],
  address,
  paymentMethod: 'COD',
});

const postOrder = (key, body = orderBody()) => {
  const req = request(app).post('/api/orders').set('token', userToken).send(body);
  if (key) req.set('Idempotency-Key', key);
  return req;
};

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
  product = await productModel.create({
    name: 'Idempotency Phone',
    description: 'Test product for the replay spec.',
    price: 999,
    image: ['https://example.com/p.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: true,
    inStock: true,
    stockQuantity: 10,
  });
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/orders — Idempotency-Key replay (AF-1 mechanism)', () => {
  it('replays the original order on key resubmission: one order, one stock reservation', async () => {
    const stockBefore = (await productModel.findById(product._id)).stockQuantity;

    const first = await postOrder('key-replay-1');
    expect(first.status).toBeLessThan(400);
    expect(first.body.order).toBeTruthy();
    const orderId = String(first.body.order._id);

    const stockAfterFirst = (await productModel.findById(product._id)).stockQuantity;
    expect(stockAfterFirst).toBe(stockBefore - 1); // reserved exactly once

    const replay = await postOrder('key-replay-1');
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(String(replay.body.order._id)).toBe(orderId); // SAME order, not a second one

    // No second order, no second stock reservation
    expect(await orderModel.countDocuments({ userId: user._id, idempotencyKey: 'key-replay-1' })).toBe(1);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(stockAfterFirst);
  });

  it('different keys create distinct orders (each reserving stock)', async () => {
    const a = await postOrder('key-distinct-a');
    const b = await postOrder('key-distinct-b');
    expect(a.status).toBeLessThan(400);
    expect(b.status).toBeLessThan(400);
    expect(String(a.body.order._id)).not.toBe(String(b.body.order._id));
    expect(await orderModel.countDocuments({ userId: user._id, idempotencyKey: { $in: ['key-distinct-a', 'key-distinct-b'] } })).toBe(2);
  });

  it('rejects an oversized key (>200 chars) with 400', async () => {
    const res = await postOrder('x'.repeat(201));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too long/i);
    // And nothing was created for that key
    expect(await orderModel.countDocuments({ idempotencyKey: 'x'.repeat(201) })).toBe(0);
  });

  it('concurrent same-key submissions converge to exactly one order (unique-index backstop)', async () => {
    const stockBefore = (await productModel.findById(product._id)).stockQuantity;
    const key = 'key-race-1';

    const results = await Promise.all(
      Array.from({ length: 5 }, () => postOrder(key).then((r) => r.status).catch(() => 'ERR'))
    );

    // Data integrity is the invariant: exactly one order exists for the key
    // and stock was reserved exactly once — regardless of which individual
    // requests won, replayed, or were rejected by the unique index.
    expect(await orderModel.countDocuments({ userId: user._id, idempotencyKey: key })).toBe(1);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(stockBefore - 1);
    // At least one submission must have succeeded end-to-end.
    expect(results.filter((s) => s < 400).length).toBeGreaterThanOrEqual(1);
  });
});
