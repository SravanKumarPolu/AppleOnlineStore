// Phase 3 regression — shopper/admin token boundary.
//
// The audit confirmed authUser (shopper middleware) used to ACCEPT admin
// tokens (type:'admin') and pass them through with req.user.id = null.
// Controllers individually rejected the null id, but the boundary itself was
// inconsistent, and the analytics routes even REQUIRED the hole (they chained
// protect+admin). These tests pin the corrected central boundary:
//
//   - admin tokens are rejected (403) by EVERY authUser-protected endpoint
//   - shopper tokens continue to work on those endpoints (no behavior loss)
//   - admin endpoints keep working with admin tokens (authAdmin unchanged)
//   - cross-user access remains closed (user A cannot read user B's data)
//   - tampered / forged / role-escalated tokens remain rejected
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeAdminToken,
  createTestUserDoc,
} from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;
let shopper;
let otherShopper;
let adminToken;

beforeAll(async () => {
  db = await startTestDb();
  shopper = await createTestUserDoc('user');
  otherShopper = await createTestUserDoc('user');
  adminToken = makeAdminToken('admin@test.local');

  // A real order + cart content for the ownership checks.
  await userModel.findByIdAndUpdate(shopper._id, {
    cartData: { 'PROD-A': { Black: 2 } },
  });
});

afterAll(async () => {
  await stopTestDb(db);
});

const shopperToken = () => jwt.sign({ id: String(shopper._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
const otherToken = () => jwt.sign({ id: String(otherShopper._id) }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Every route in this table sits behind authUser (shopper middleware).
const SHOPPER_ROUTES = [
  ['get', '/api/user/profile'],
  ['put', '/api/user/profile'],
  ['get', '/api/user/addresses'],
  ['post', '/api/cart/get'],
  ['post', '/api/orders/userorders'],
];

describe('authUser rejects admin tokens on shopper endpoints (Phase 3 fix)', () => {
  for (const [method, path] of SHOPPER_ROUTES) {
    it(`${method.toUpperCase()} ${path} → 403 for an admin token`, async () => {
      const res = await request(app)
        [method](path)
        .set('token', adminToken)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it(`${method.toUpperCase()} ${path} → 403 for an admin token via Authorization: Bearer`, async () => {
      const res = await request(app)
        [method](path)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(403);
    });
  }

  it('POST /api/orders (checkout) → 403 for an admin token', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', adminToken)
      .send({ items: [], address: {}, paymentMethod: 'COD' });
    expect(res.status).toBe(403);
  });

  it('POST /api/analytics/track-activity → 403 for an admin token', async () => {
    const res = await request(app)
      .post('/api/analytics/track-activity')
      .set('token', adminToken)
      .send({ action: 'view_product' });
    expect(res.status).toBe(403);
  });
});

describe('authUser keeps serving legitimate shopper tokens (no behavior loss)', () => {
  it('GET /api/user/profile → 200 with the shopper profile', async () => {
    const res = await request(app).get('/api/user/profile').set('token', shopperToken());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(String(res.body.user.id)).toBe(String(shopper._id));
  });

  it('POST /api/cart/get → 200 with the shopper cart', async () => {
    const res = await request(app).post('/api/cart/get').set('token', shopperToken()).send({});
    expect(res.status).toBe(200);
    expect(res.body.cartData['PROD-A'].Black).toBe(2);
  });

  it('POST /api/analytics/track-activity → 200 for a shopper token', async () => {
    const res = await request(app)
      .post('/api/analytics/track-activity')
      .set('token', shopperToken())
      .send({ action: 'view_product' });
    expect(res.status).toBe(200);
  });
});

describe('admin endpoints keep working with admin tokens (authAdmin unchanged)', () => {
  it('GET /api/orders/all → 200 for an admin token', async () => {
    const res = await request(app).get('/api/orders/all').set('token', adminToken);
    expect(res.status).toBe(200);
  });

  it('GET /api/analytics/dashboard-summary → 200 for an admin token (protect layer removed)', async () => {
    const res = await request(app).get('/api/analytics/dashboard-summary').set('token', adminToken);
    expect(res.status).toBe(200);
  });

  it('GET /api/analytics/sales → 200 for an admin token', async () => {
    const res = await request(app).get('/api/analytics/sales').set('token', adminToken);
    expect(res.status).toBe(200);
  });

  it('shopper tokens still cannot reach admin endpoints (403)', async () => {
    const res = await request(app).get('/api/orders/all').set('token', shopperToken());
    expect(res.status).toBe(403);

    const analytics = await request(app).get('/api/analytics/sales').set('token', shopperToken());
    expect(analytics.status).toBe(403);
  });
});

describe('cross-user access stays closed (regression guard)', () => {
  it('shopper B cannot read shopper A\'s cart via body userId', async () => {
    const res = await request(app)
      .post('/api/cart/get')
      .set('token', otherToken())
      .send({ userId: String(shopper._id) });
    expect(res.status).toBe(200);
    expect(res.body.cartData['PROD-A']).toBeUndefined(); // B sees own (empty) cart
  });

  it('shopper B cannot read shopper A\'s orders', async () => {
    const res = await request(app)
      .post('/api/orders/userorders')
      .set('token', otherToken())
      .send({ userId: String(shopper._id) });
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
  });
});

describe('tampered and forged tokens remain rejected', () => {
  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ id: String(shopper._id) }, 'not-the-real-secret', { expiresIn: '1h' });
    const res = await request(app).get('/api/user/profile').set('token', forged);
    expect(res.status).toBe(401);
  });

  it('rejects a user token forged with an escalated admin role claim', async () => {
    // A user-id token claiming role admin — authAdmin must still verify the
    // DB record, and authUser must not treat it as an admin token.
    const escalated = jwt.sign({ id: String(shopper._id), role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const adminRoute = await request(app).get('/api/orders/all').set('token', escalated);
    expect(adminRoute.status).toBe(403); // shopper.role === 'user' in the DB

    const shopperRoute = await request(app).get('/api/user/profile').set('token', escalated);
    expect(shopperRoute.status).toBe(200); // still a valid shopper token for own profile
  });

  it('rejects an admin token with the type claim stripped (falls through to user path)', async () => {
    const stripped = jwt.sign({ email: 'admin@test.local', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/user/profile').set('token', stripped);
    expect(res.status).toBe(401); // no id -> user not found
  });

  it('rejects garbage tokens with 401', async () => {
    const res = await request(app).get('/api/user/profile').set('token', 'garbage.token.value');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed Authorization header safely', async () => {
    const res = await request(app).get('/api/user/profile').set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
  });
});
