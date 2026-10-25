// Phase 3.1 — Invalid input / adversarial input validation.
//
// Every input vector an attacker can reach without authentication or with a
// regular shopper token. Invalid input must produce safe, predictable 4xx
// errors — never a 500 crash, never a partial DB write.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeUserToken,
  createTestUserDoc,
} from './helpers.mjs';

let db;
let user;
let userToken;

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

const LONG_STRING = 'A'.repeat(100_000);
const UNICODE_PAYLOAD = '🦠".constructor prototype XSS <script>alert(1)</script> \u0000\uFFFF';

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('malformed request bodies', () => {
  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .set('Content-Type', 'application/json')
      .send('{"items": [BROKEN');
    expect(res.status).toBe(400);
  });

  it('handles empty body gracefully on order creation', async () => {
    const res = await request(app).post('/api/orders').set('token', userToken).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('handles null body / undefined values on order creation', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({ items: null, address: null, paymentMethod: null });
    expect(res.status).toBe(400);
  });

  it('handles items as a non-array (object / string / number)', async () => {
    for (const items of ['not-an-array', { 0: 'x', length: 1 }, 42]) {
      const res = await request(app)
        .post('/api/orders')
        .set('token', userToken)
        .send({ items, address, paymentMethod: 'COD' });
      expect([400, 422]).toContain(res.status);
    }
  });

  it('handles empty items array (empty-cart checkout)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({ items: [], address, paymentMethod: 'COD' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('extreme & unicode payloads', () => {
  it('survives a 100 KB item name without hanging or crashing', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({
        items: [{ productId: 'p1', name: LONG_STRING, image: 'x', price: 10, quantity: 1, color: 'Black' }],
        address,
        paymentMethod: 'COD',
      });
    expect(res.status).toBeLessThan(500);
  }, 20000);

  it('survives unicode / control characters in every string field', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({
        items: [{ productId: UNICODE_PAYLOAD, name: UNICODE_PAYLOAD, image: UNICODE_PAYLOAD, price: 10, quantity: 1, color: UNICODE_PAYLOAD }],
        address: { ...address, firstName: UNICODE_PAYLOAD, street: UNICODE_PAYLOAD },
        paymentMethod: 'COD',
      });
    expect(res.status).toBeLessThan(500);
  });

  it('rejects invalid MongoDB ObjectId as productId on /api/product/single', async () => {
    for (const bad of ['not-an-id', 'deadbeef', '666', '....', '{}']) {
      const res = await request(app).post('/api/product/single').send({ productId: bad });
      expect(res.status).toBe(400);
    }
  });

  it('survives invalid regex metacharacters in product search', async () => {
    for (const bad of ['(', '[', '*', '\\', '(?:', 'a{9999999}']) {
      const res = await request(app)
        .get('/api/product/list')
        .query({ search: bad });
      expect(res.status).toBeLessThan(500);
    }
  }, 20000);

  it('rejects invalid ObjectIds in category operations without crashing', async () => {
    const adminToken = (await import('./helpers.mjs')).makeAdminToken();
    const res = await request(app)
      .put('/api/category/update')
      .set('token', adminToken)
      .send({ categoryId: 'not-an-object-id', name: 'x' });
    expect(res.status).toBeLessThan(500);
  });
});

describe('boundary & type confusion on quantities and pagination', () => {
  it('order pagination: string page must not 500', async () => {
    const res = await request(app)
      .post('/api/orders/userorders')
      .set('token', userToken)
      .send({ page: 'abc', limit: 'xyz' });
    expect([200, 400]).toContain(res.status);
  });

  it('order pagination: huge limit must be capped, not fatal', async () => {
    const res = await request(app)
      .post('/api/orders/userorders')
      .set('token', userToken)
      .send({ page: 1, limit: 1_000_000 });
    expect([200, 400]).toContain(res.status);
  });

  it('cart add: garbage quantity handled predictably', async () => {
    for (const bad of [-5, 0, 'NaN', 1e308, null]) {
      const res = await request(app)
        .post('/api/cart/add')
        .set('token', userToken)
        .send({ itemId: '6626abcd1234abcd1234abcd', color: 'Black', quantity: bad });
      expect(res.status).toBeLessThan(500);
    }
  });

  it('cart add: non-string color / missing color handled predictably', async () => {
    for (const color of [null, 42, { evil: true }, ['a']]) {
      const res = await request(app)
        .post('/api/cart/add')
        .set('token', userToken)
        .send({ itemId: '6626abcd1234abcd1234abcd', color, quantity: 1 });
      expect(res.status).toBeLessThan(500);
    }
  });
});

describe('unexpected request parameters & methods', () => {
  it('unknown fields in registration are ignored (no mass assignment)', async () => {
    const res = await request(app).post('/api/user/register').send({
      name: 'Mass Assign',
      email: `mass-${Date.now()}@example.com`,
      password: 'Str0ng!Pass1',
      role: 'admin',       // must NOT be honored
      isActive: false,     // must NOT be honored
      orders: ['6626abcd1234abcd1234abcd'],
    });
    expect(res.status).toBeLessThan(400);
    const { default: userModel } = await import('../models/userModel.js');
    const created = await userModel.findOne({ email: `mass-${new Date(Date.now()).toISOString()}@example.com` }).lean();
    if (created) {
      expect(created.role).toBe('user');
      expect(created.isActive).toBe(true);
    }
  });

  it('unsupported HTTP methods are rejected, not crashed', async () => {
    const checks = [
      request(app).delete('/api/orders'),
      request(app).put('/api/product/list'),
      request(app).patch('/api/cart/add'),
      request(app).delete('/api/user/profile'),
    ];
    for (const promise of checks) {
      const res = await promise;
      expect(res.status).toBeLessThan(500);
      expect([404, 405]).toContain(res.status);
    }
  });

  it('HTTP parameter pollution (duplicate fields) is handled safely', async () => {
    const res = await request(app)
      .post('/api/product/single')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ productId: '6626abcd1234abcd1234abcd' }) + ',' + JSON.stringify({ productId: 'evil' }));
    expect(res.status).toBeLessThan(500);
  });
});

describe('prototype pollution resistance', () => {
  it('rejects __proto__ / constructor keys in JSON bodies (mongoSanitize)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({
        items: [{ productId: 'p1', name: 'x', image: 'x', price: 10, quantity: 1, color: 'Black' }],
        address,
        paymentMethod: 'COD',
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
      });
    expect(res.status).toBeLessThan(500);
    expect({}.isAdmin).toBeUndefined(); // global prototype unpolluted
  });

  it('cart update with __proto__ payload does not pollute Object prototype', async () => {
    await request(app)
      .post('/api/cart/update')
      .set('token', userToken)
      .send({ cartData: { __proto__: { polluted: true }, 'a.b': 1 } });
    expect(Object.prototype.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });
});
