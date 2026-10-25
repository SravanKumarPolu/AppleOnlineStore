// Phase 3.3 — Authorization attacks / IDOR (Insecure Direct Object References).
//
// Verifies that ordinary users can never: read or modify another user's
// orders, access another user's private data, mutate products/categories,
// change order status, or perform privileged operations.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeUserToken,
  createTestUserDoc,
  createTestOrderDoc,
} from './helpers.mjs';
import orderModel from '../models/orderModel.js';

let db;
let alice;
let bob;
let aliceToken;
let bobToken;
let aliceOrder;
let bobOrder;

beforeAll(async () => {
  db = await startTestDb();
  alice = await createTestUserDoc('user');
  bob = await createTestUserDoc('user');
  aliceToken = makeUserToken(alice._id);
  bobToken = makeUserToken(bob._id);
  aliceOrder = await createTestOrderDoc(alice._id);
  bobOrder = await createTestOrderDoc(bob._id);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('order privacy (BOLA / IDOR)', () => {
  it('userorders only returns the caller own orders', async () => {
    const res = await request(app)
      .post('/api/orders/userorders')
      .set('token', aliceToken)
      .send({});
    expect(res.status).toBe(200);
    const orders = res.body.orders || res.body.data || [];
    const ids = orders.map((o) => String(o._id));
    expect(ids).toContain(String(aliceOrder._id));
    expect(ids).not.toContain(String(bobOrder._id));
  });

  it('a userId supplied in the body cannot widen the query (IDOR via body)', async () => {
    const res = await request(app)
      .post('/api/orders/userorders')
      .set('token', aliceToken)
      .send({ userId: String(bob._id) });
    expect(res.status).toBe(200);
    const orders = res.body.orders || res.body.data || [];
    const ids = orders.map((o) => String(o._id));
    expect(ids).not.toContain(String(bobOrder._id));
  });

  it('cart endpoints are owner-scoped: body userId cannot read another cart', async () => {
    const res = await request(app)
      .post('/api/cart/get')
      .set('token', aliceToken)
      .send({ userId: String(bob._id) });
    expect(res.status).toBe(200);
    const cart = res.body.cartData;
    expect(JSON.stringify(cart)).not.toContain(String(bob._id));
  });

  it('address book operations are owner-scoped (cannot edit another user address)', async () => {
    // Alice adds an address (all schema-required fields).
    const add = await request(app)
      .post('/api/user/addresses')
      .set('token', aliceToken)
      .send({
        firstName: 'Alice',
        lastName: 'A',
        email: 'alice@example.com',
        street: '1 A St',
        city: 'City',
        state: 'ST',
        zipcode: '12345',
        country: 'Land',
        phone: '5550001111',
      });
    expect(add.status).toBeLessThan(400);
    const aliceAddresses = add.body.addresses || [];
    const aliceAddressId = aliceAddresses[aliceAddresses.length - 1]?._id;
    expect(aliceAddressId).toBeTruthy();

    // Bob tries to edit / delete Alice's address by id.
    const edit = await request(app)
      .put(`/api/user/addresses/${aliceAddressId}`)
      .set('token', bobToken)
      .send({ city: 'Hacked' });
    expect([403, 404]).toContain(edit.status);

    const del = await request(app)
      .delete(`/api/user/addresses/${aliceAddressId}`)
      .set('token', bobToken);
    expect([403, 404]).toContain(del.status);
  });

  it('profile updates cannot target another user (body userId ignored)', async () => {
    const res = await request(app)
      .put('/api/user/profile')
      .set('token', bobToken)
      .send({ userId: String(alice._id), name: 'Hacked Name' });
    expect(res.status).toBeLessThan(400);
    const { default: userModel } = await import('../models/userModel.js');
    const freshAlice = await userModel.findById(alice._id);
    expect(freshAlice.name).not.toBe('Hacked Name');
  });
});

describe('privileged operation attempts by ordinary users', () => {
  it('cannot change order status (even own order)', async () => {
    const res = await request(app)
      .put('/api/orders/status')
      .set('token', aliceToken)
      .send({ orderId: String(aliceOrder._id), status: 'Delivered' });
    expect(res.status).toBe(403);
    const fresh = await orderModel.findById(aliceOrder._id);
    expect(fresh.orderStatus).toBe('Order Placed');
  });

  it('cannot delete products', async () => {
    const res = await request(app)
      .post('/api/product/remove')
      .set('token', aliceToken)
      .send({ productId: '6626abcd1234abcd1234abcd' });
    expect(res.status).toBe(403);
  });

  it('cannot mutate categories', async () => {
    const attempts = [
      ['post', '/api/category/add', { name: 'Hacked', description: 'x' }],
      ['put', '/api/category/update', { categoryId: '6626abcd1234abcd1234abcd', name: 'Hacked' }],
      ['delete', '/api/category/delete', { categoryId: '6626abcd1234abcd1234abcd' }],
      ['post', '/api/category/subcategory/add', { categoryId: '6626abcd1234abcd1234abcd', name: 'Hacked' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await request(app)[method](path).set('token', aliceToken).send(body);
      expect(res.status).toBe(403);
    }
  });

  it('cannot run analytics cleanup / read analytics', async () => {
    const reads = [
      ['get', '/api/analytics/dashboard-summary'],
      ['get', '/api/analytics/sales'],
      ['get', '/api/analytics/products'],
      ['get', '/api/analytics/user-behavior'],
      ['get', '/api/analytics/search'],
      ['post', '/api/analytics/cleanup', {}],
    ];
    for (const [method, path, body] of reads) {
      const res = await request(app)[method](path).set('token', aliceToken).send(body);
      expect(res.status).toBe(403);
    }
  });

  it('cannot approve refunds / mark orders refunded', async () => {
    const res = await request(app)
      .put('/api/orders/status')
      .set('token', aliceToken)
      .send({ orderId: String(aliceOrder._id), status: 'Cancelled' });
    expect(res.status).toBe(403);
    const fresh = await orderModel.findById(aliceOrder._id);
    expect(fresh.paymentStatus).not.toBe('refunded');
  });

  it('cannot access debug endpoints', async () => {
    const res1 = await request(app).get('/api/orders/debug').set('token', aliceToken);
    const res2 = await request(app).get('/api/user/debug').set('token', aliceToken);
    expect(res1.status).toBe(403);
    expect(res2.status).toBe(403);
  });
});

describe('admin token boundaries', () => {
  it('admin tokens cannot act as a shopper on cart endpoints (null id rejected)', async () => {
    const { makeAdminToken } = await import('./helpers.mjs');
    const res = await request(app)
      .post('/api/cart/add')
      .set('token', makeAdminToken())
      .send({ itemId: '6626abcd1234abcd1234abcd', color: 'Black', quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('admin tokens cannot place shopper orders via generic endpoint', async () => {
    const { makeAdminToken } = await import('./helpers.mjs');
    const res = await request(app)
      .post('/api/orders')
      .set('token', makeAdminToken())
      .send({
        items: [{ productId: 'p1', name: 'x', image: 'x', price: 1, quantity: 1, color: 'Black' }],
        address: { firstName: 'A', street: '1', city: 'C', state: 'S', zipcode: '1', country: 'X', phone: '1', email: 'a@b.c', lastName: 'B' },
        paymentMethod: 'COD',
      });
    // Phase 3 fix: authUser rejects admin tokens centrally (403) instead of
    // the controller rejecting the null user id later (was 401).
    expect(res.status).toBe(403);
  });
});
