// Traceability-matrix gap: "Address book CRUD (userController address
// handlers)" had no backend spec. These handlers operate on addresses
// embedded in the user document, so ownership isolation is structural —
// every handler resolves the user from the token, never from the body.
//
// NOTE (K-11, NOT fixed — outside approved scope): the FRONTEND mutation
// callers post to a singular /api/user/address... path that is unrouted, so
// from the browser only the GET list works. This spec pins the BACKEND
// contract of the routed plural endpoints that the frontend will use once
// K-11 is approved and fixed.
//
// NOTE: /api/user/* routes share the authLimiter (20 requests / 15 min / IP);
// this spec uses 13 — keep the budget in mind when adding tests.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  makeUserToken,
} from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;
let userA;
let userB;
let tokenA;
let tokenB;

const address = (overrides = {}) => ({
  firstName: 'Ada',
  lastName: 'Shopper',
  email: 'ada@example.com',
  street: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '555-0100',
  ...overrides,
});

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUserDoc('user');
  userB = await createTestUserDoc('user');
  tokenA = makeUserToken(userA._id);
  tokenB = makeUserToken(userB._id);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('/api/user/addresses — authentication guard', () => {
  it('rejects every address route without a token (401, nothing written)', async () => {
    const attempts = [
      ['post', '/api/user/addresses'],
      ['get', '/api/user/addresses'],
      ['put', '/api/user/addresses/default'],
      ['put', '/api/user/addresses/507f1f77bcf86cd799439011'],
      ['delete', '/api/user/addresses/507f1f77bcf86cd799439011'],
    ];

    for (const [method, path] of attempts) {
      const res = await request(app)[method](path).send(
        method === 'get' ? {} : address()
      );
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }

    const saved = await userModel.findById(userA._id);
    expect(saved.addresses).toHaveLength(0);
  });
});

describe('/api/user/addresses — CRUD semantics', () => {
  let firstId;
  let secondId;

  it('adds a first address — as-built: NOT auto-defaulted unless the client flags it', async () => {
    // The controller comment says the first address becomes the default, but
    // the implementation only DEMOTES other addresses; the pushed subdocument
    // keeps whatever `default` value the client sent. Pin the as-built
    // behavior (the storefront sends default explicitly when needed).
    const res = await request(app)
      .post('/api/user/addresses')
      .set('token', tokenA)
      .send(address());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.addresses).toHaveLength(1);
    expect(res.body.addresses[0].default).toBe(false);

    firstId = res.body.addresses[0]._id;
  });

  it('lists the stored addresses', async () => {
    const res = await request(app)
      .get('/api/user/addresses')
      .set('token', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(1);
    expect(res.body.addresses[0].city).toBe('Springfield');
  });

  it('adding a second address flagged default demotes the first', async () => {
    const res = await request(app)
      .post('/api/user/addresses')
      .set('token', tokenA)
      .send(address({ street: '2 Oak Ave', default: true }));

    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(2);
    const byId = Object.fromEntries(res.body.addresses.map((a) => [a._id, a]));
    expect(byId[firstId].default).toBe(false);
    const newlyAdded = res.body.addresses.find((a) => a.street === '2 Oak Ave');
    expect(newlyAdded.default).toBe(true);
    secondId = newlyAdded._id;
  });

  it('edits an address by id (partial update)', async () => {
    const res = await request(app)
      .put(`/api/user/addresses/${firstId}`)
      .set('token', tokenA)
      .send({ city: 'Chicago' });

    expect(res.status).toBe(200);
    const edited = res.body.addresses.find((a) => a._id === firstId);
    expect(edited.city).toBe('Chicago');
    expect(edited.street).toBe('1 Main St'); // untouched fields survive
  });

  it('switches the default address', async () => {
    const res = await request(app)
      .put('/api/user/addresses/default')
      .set('token', tokenA)
      .send({ addressId: firstId });

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.addresses.map((a) => [a._id, a]));
    expect(byId[firstId].default).toBe(true);
    expect(byId[secondId].default).toBe(false);
  });

  it('isolates users: user B cannot edit user A\'s address (404, A untouched)', async () => {
    const res = await request(app)
      .put(`/api/user/addresses/${firstId}`)
      .set('token', tokenB)
      .send({ city: 'Hacker City' });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/address not found/i);

    const saved = await userModel.findById(userA._id);
    const target = saved.addresses.id(firstId);
    expect(target.city).toBe('Chicago');
  });

  it('deletes an address', async () => {
    const res = await request(app)
      .delete(`/api/user/addresses/${secondId}`)
      .set('token', tokenA);

    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(1);

    const saved = await userModel.findById(userA._id);
    expect(saved.addresses).toHaveLength(1);
  });

  it('returns 404 when deleting an address that does not exist', async () => {
    const res = await request(app)
      .delete(`/api/user/addresses/${firstId}`)
      .set('token', tokenB); // user B never had this address

    expect(res.status).toBe(404);
  });
});
