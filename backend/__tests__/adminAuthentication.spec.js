// Traceability-matrix gap: "Admin login (userController.adminLogin)" had no
// direct spec — only the *enforcement* of admin tokens was covered. Pins the
// credential check against the ADMIN_EMAIL/ADMIN_PASSWORD configuration and
// proves the issued token actually passes authAdmin on a real admin route.
//
// NOTE: /api/user/* routes share the authLimiter (20 requests / 15 min / IP);
// this spec uses 5 requests there (+2 to /api/orders, which is unlimited).
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import app from '../app.js';
import { startTestDb, stopTestDb, createTestUserDoc, makeUserToken } from './helpers.mjs';

let db;
let shopperToken;

const adminLogin = (body) =>
  request(app).post('/api/user/admin').send(body);

beforeAll(async () => {
  db = await startTestDb();
  const shopper = await createTestUserDoc('user');
  shopperToken = makeUserToken(shopper._id);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/user/admin — admin login', () => {
  it('issues an admin token for the configured credentials', async () => {
    const res = await adminLogin({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({ email: process.env.ADMIN_EMAIL, role: 'admin' });

    const decoded = jwt.decode(res.body.token);
    expect(decoded.email).toBe(process.env.ADMIN_EMAIL);
    expect(decoded.role).toBe('admin');
    expect(decoded.type).toBe('admin');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await adminLogin({
      email: process.env.ADMIN_EMAIL,
      password: 'definitely-not-the-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid admin credentials/i);
  });

  it('rejects a wrong email with 401', async () => {
    const res = await adminLogin({
      email: 'root@example.com',
      password: process.env.ADMIN_PASSWORD,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a missing password with 400 (validation middleware)', async () => {
    const res = await adminLogin({ email: process.env.ADMIN_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects regular shopper credentials with 401 (admins are env-configured, not DB users)', async () => {
    const shopper = await createTestUserDoc('user');
    const res = await adminLogin({ email: shopper.email, password: 'TestPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid admin credentials/i);
  });
});

describe('adminLogin token — passes authAdmin on a real admin route', () => {
  it('reads all orders with the issued admin token (GET /api/orders/all)', async () => {
    const login = await adminLogin({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    expect(login.status).toBe(200);

    const res = await request(app)
      .get('/api/orders/all')
      .set('token', login.body.token);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.orders)).toBe(true);
  });

  it('still rejects a regular user token on the same route (403)', async () => {
    const res = await request(app)
      .get('/api/orders/all')
      .set('token', shopperToken);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin/i);
  });
});
