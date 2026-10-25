// Phase 1 work area 1 — admin authorization on order-status routes.
// Real middleware chain + real MongoDB; only tokens are forged exactly as
// the attack scenario requires.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeAdminToken,
  makeUserToken,
  createTestUserDoc,
  createTestOrderDoc,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';

let db;
let adminToken;
let userToken;
let orderId;

beforeAll(async () => {
  db = await startTestDb();
  const user = await createTestUserDoc('user');
  adminToken = makeAdminToken();
  userToken = makeUserToken(user._id);
  const order = await createTestOrderDoc(user._id);
  orderId = order._id;
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('PUT /api/orders/status authorization', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).put('/api/orders/status').send({ orderId: String(orderId), status: 'Shipped' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects authenticated non-admin (user token) requests with 403', async () => {
    const res = await request(app)
      .put('/api/orders/status')
      .set('token', userToken)
      .send({ orderId: String(orderId), status: 'Shipped' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    // Authorization bypass attempt — alternate header format must also fail.
    const resBearer = await request(app)
      .put('/api/orders/status')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId: String(orderId), status: 'Shipped' });
    expect(resBearer.status).toBe(403);
  });

  it('rejects an invalid status value with 400 even for admins', async () => {
    const res = await request(app)
      .put('/api/orders/status')
      .set('token', adminToken)
      .send({ orderId: String(orderId), status: 'HACKED-STATUS' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid order status/);

    const unchanged = await orderModel.findById(orderId);
    expect(unchanged.orderStatus).toBe('Order Placed');
  });

  it('allows an authorized admin update and persists the new status', async () => {
    const res = await request(app)
      .put('/api/orders/status')
      .set('token', adminToken)
      .send({ orderId: String(orderId), status: 'Shipped' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.orderStatus).toBe('Shipped');

    const updated = await orderModel.findById(orderId);
    expect(updated.orderStatus).toBe('Shipped');
  });
});

describe('GET /api/orders/debug authorization', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/orders/debug');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects authenticated non-admin requests with 403', async () => {
    const res = await request(app).get('/api/orders/debug').set('token', userToken);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('allows admin access (200)', async () => {
    const res = await request(app).get('/api/orders/debug').set('token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/user/debug authorization (user dump)', () => {
  it('rejects authenticated non-admin requests with 403', async () => {
    const res = await request(app).get('/api/user/debug').set('token', userToken);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('allows admin access (200)', async () => {
    const res = await request(app).get('/api/user/debug').set('token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
