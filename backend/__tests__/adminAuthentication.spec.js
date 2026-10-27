// Traceability-matrix gap: "Admin login (userController.adminLogin)" had no
// direct spec — only the *enforcement* of admin tokens was covered. Pins the
// credential check against the ADMIN_EMAIL/ADMIN_PASSWORD configuration and
// proves the issued token actually passes authAdmin on a real admin route.
//
// NOTE: /api/user/* routes share the authLimiter (20 requests / 15 min / IP);
// this spec stays below that limit with 14 requests to /api/user/*.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import app from '../app.js';
import { startTestDb, stopTestDb, createTestUserDoc, makeUserToken } from './helpers.mjs';

const TEST_ADMIN_EMAIL = 'Admin.Test@NovaCart.com';
const TEST_ADMIN_PASSWORD = 'Synthetic-Admin-Pass-42!';
const TEST_JWT_SECRET = 'synthetic-admin-jwt-secret-for-tests-only-123456';
const AUTH_ENV_KEYS = ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'JWT_SECRET'];
const originalAuthEnv = Object.fromEntries(
  AUTH_ENV_KEYS.map((key) => [key, process.env[key]])
);

let db;
let shopperToken;

const adminLogin = (body) =>
  request(app).post('/api/user/admin').send(body);

async function withAuthEnv(overrides, operation) {
  const previous = Object.fromEntries(AUTH_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await operation();
  } finally {
    for (const key of AUTH_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

beforeAll(async () => {
  process.env.ADMIN_EMAIL = `  ${TEST_ADMIN_EMAIL}  `;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  db = await startTestDb();
  const shopper = await createTestUserDoc('user');
  shopperToken = makeUserToken(shopper._id);
});

afterAll(async () => {
  await stopTestDb(db);
  for (const key of AUTH_ENV_KEYS) {
    if (originalAuthEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalAuthEnv[key];
  }
});

describe('POST /api/user/admin — admin login', () => {
  it('issues a valid admin token for the configured synthetic credentials', async () => {
    const res = await adminLogin({
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({ email: 'admin.test@novacart.com', role: 'admin' });

    const decoded = jwt.verify(res.body.token, TEST_JWT_SECRET);
    expect(decoded.email).toBe('admin.test@novacart.com');
    expect(decoded.role).toBe('admin');
    expect(decoded.type).toBe('admin');
    expect(decoded.exp - decoded.iat).toBe(24 * 60 * 60);
  });

  it('accepts an uppercase email domain and surrounding email whitespace', async () => {
    const res = await adminLogin({
      email: '  Admin.Test@NOVACART.COM ',
      password: TEST_ADMIN_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin.test@novacart.com');
  });

  it('normalizes mixed-case email characters consistently', async () => {
    const res = await adminLogin({
      email: 'aDmIn.TeSt@nOvAcArT.cOm',
      password: TEST_ADMIN_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin.test@novacart.com');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await adminLogin({
      email: TEST_ADMIN_EMAIL,
      password: 'definitely-not-the-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid admin credentials/i);
  });

  it('does not trim or otherwise normalize the submitted password', async () => {
    const res = await adminLogin({
      email: TEST_ADMIN_EMAIL,
      password: ` ${TEST_ADMIN_PASSWORD}`,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a wrong email with 401', async () => {
    const res = await adminLogin({
      email: 'root@example.com',
      password: TEST_ADMIN_PASSWORD,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a missing password with 400 (validation middleware)', async () => {
    const res = await adminLogin({ email: TEST_ADMIN_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects malformed email with 400 (validation middleware)', async () => {
    const res = await adminLogin({ email: 'not-an-email', password: TEST_ADMIN_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns a safe configuration error when ADMIN_EMAIL is missing', async () => {
    const res = await withAuthEnv({ ADMIN_EMAIL: undefined }, () =>
      adminLogin({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Admin configuration error' });
  });

  it('returns a safe configuration error when ADMIN_EMAIL is blank', async () => {
    const res = await withAuthEnv({ ADMIN_EMAIL: '   ' }, () =>
      adminLogin({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Admin configuration error' });
  });

  it('returns a safe configuration error when ADMIN_PASSWORD is missing', async () => {
    const res = await withAuthEnv({ ADMIN_PASSWORD: undefined }, () =>
      adminLogin({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Admin configuration error' });
  });

  it('returns a safe configuration error when ADMIN_PASSWORD is blank', async () => {
    const res = await withAuthEnv({ ADMIN_PASSWORD: '   ' }, () =>
      adminLogin({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Admin configuration error' });
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
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
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
