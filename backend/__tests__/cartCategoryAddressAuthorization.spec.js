// Final gate Task 4 — authorization closures on cart, category, address.
// Confirmed vulnerabilities these tests pin:
//   - cart routes trusted body userId (cross-user read/write = IDOR, Critical)
//   - category mutations had no middleware despite "admin only" comments
//   - POST /api/address/save was fully unauthenticated
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  makeUserToken,
  makeAdminToken,
} from './helpers.mjs';
import userModel from '../models/userModel.js';
import categoryModel from '../models/categoryModel.js';
import addressModel from '../models/addressModel.js';

let db;
let userA;
let userB;
let tokenA;
let tokenB;
let adminToken;

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUserDoc('user');
  userB = await createTestUserDoc('user');
  tokenA = makeUserToken(userA._id);
  tokenB = makeUserToken(userB._id);
  adminToken = makeAdminToken('admin@test.local');
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/cart/* — authentication + ownership (IDOR closed)', () => {
  const CART_ROUTES = ['/add', '/get', '/update', '/sync-local'];

  it('rejects every cart route without a token (401)', async () => {
    for (const route of CART_ROUTES) {
      const res = await request(app).post(`/api/cart${route}`).send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  });

  it('rejects invalid tokens (401)', async () => {
    const res = await request(app)
      .post('/api/cart/get')
      .set('token', 'not-a-jwt')
      .send({});
    expect(res.status).toBe(401);
  });

  it('serves ONLY the authenticated user\'s cart even when the body names another user', async () => {
    // userB has a cart; the attacker (A) sends B's userId in the body.
    await userModel.findByIdAndUpdate(userB._id, {
      cartData: { 'PROD-VICTIM': { Black: 2 } },
    });
    await userModel.findByIdAndUpdate(userA._id, { cartData: {} });

    const res = await request(app)
      .post('/api/cart/get')
      .set('token', tokenA)
      .send({ userId: String(userB._id) }); // spoofed ownership claim

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Attacker got THEIR OWN (empty) cart, not the victim's.
    expect(res.body.cartData).toEqual({});

    const victim = await userModel.findById(userB._id).lean();
    expect(victim.cartData).toEqual({ 'PROD-VICTIM': { Black: 2 } }); // untouched
  });

  it('blocks cross-user cart WRITES (body userId is ignored)', async () => {
    await userModel.findByIdAndUpdate(userA._id, { cartData: {} });
    await userModel.findByIdAndUpdate(userB._id, { cartData: { 'PROD-VICTIM': { Black: 2 } } });

    const res = await request(app)
      .post('/api/cart/add')
      .set('token', tokenA)
      .send({ userId: String(userB._id), itemId: 'PROD-VICTIM', color: 'Black' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The write landed on the ATTACKER's cart…
    const attacker = await userModel.findById(userA._id).lean();
    expect(attacker.cartData).toEqual({ 'PROD-VICTIM': { Black: 1 } });
    // …and the victim's quantities are unchanged.
    const victim = await userModel.findById(userB._id).lean();
    expect(victim.cartData).toEqual({ 'PROD-VICTIM': { Black: 2 } });
  });

  it('blocks cross-user cart UPDATES (body userId is ignored)', async () => {
    await userModel.findByIdAndUpdate(userA._id, { cartData: { 'PROD-SHARED': { White: 1 } } });
    await userModel.findByIdAndUpdate(userB._id, { cartData: { 'PROD-SHARED': { White: 1 } } });

    const res = await request(app)
      .post('/api/cart/update')
      .set('token', tokenA)
      .send({ userId: String(userB._id), itemId: 'PROD-SHARED', color: 'White', quantity: 99 });

    expect(res.status).toBe(200);
    const attacker = await userModel.findById(userA._id).lean();
    expect(attacker.cartData['PROD-SHARED'].White).toBe(99);
    const victim = await userModel.findById(userB._id).lean();
    expect(victim.cartData['PROD-SHARED'].White).toBe(1); // untouched
  });

  it('rejects admin tokens for cart operations (403 — carts are per-shopper)', async () => {
    const res = await request(app)
      .post('/api/cart/get')
      .set('token', adminToken)
      .send({});
    expect(res.status).toBe(403);
  });

  it('still lets the owner read and sync their own cart', async () => {
    await userModel.findByIdAndUpdate(userA._id, { cartData: { 'PROD-OWN': { Red: 3 } } });

    const read = await request(app)
      .post('/api/cart/get')
      .set('token', tokenA)
      .send({ userId: String(userA._id) });
    expect(read.status).toBe(200);
    expect(read.body.cartData).toEqual({ 'PROD-OWN': { Red: 3 } });

    const sync = await request(app)
      .post('/api/cart/sync-local')
      .set('token', tokenA)
      .send({ userId: String(userA._id), cartData: { 'PROD-OWN': { Red: 4 } } });
    expect(sync.status).toBe(200);
    const after = await userModel.findById(userA._id).lean();
    expect(after.cartData).toEqual({ 'PROD-OWN': { Red: 4 } });
  });
});

describe('/api/category/* — mutation authorization', () => {
  const MUTATION_CASES = [
    ['post', '/api/category/add'],
    ['put', '/api/category/update'],
    ['delete', '/api/category/delete'],
    ['post', '/api/category/subcategory/add'],
    ['put', '/api/category/subcategory/update'],
    ['delete', '/api/category/subcategory/remove'],
  ];

  it('keeps the category list public (storefront catalog)', async () => {
    const res = await request(app).get('/api/category/list');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it('rejects unauthenticated mutations (401)', async () => {
    for (const [method, path] of MUTATION_CASES) {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
    }
  });

  it('rejects authenticated non-admin mutations (403)', async () => {
    for (const [method, path] of MUTATION_CASES) {
      const res = await request(app)[method](path).set('token', tokenA).send({});
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/admin/i);
    }
  });

  it('allows admins to create categories (real DB write)', async () => {
    const name = `Gate-Test-Category-${Date.now()}`;
    const res = await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ name, description: 'created by authorization regression', sortOrder: 1 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const doc = await categoryModel.findOne({ name }).lean();
    expect(doc).toBeTruthy();
    expect(doc.description).toBe('created by authorization regression');
  });
});

describe('POST /api/address/save — authentication required', () => {
  const validAddress = {
    firstName: 'Gate',
    lastName: 'Test',
    email: 'gate.test@example.com',
    street: '1 Test Street',
    city: 'Test City',
    state: 'TS',
    zipcode: '12345',
    country: 'Testland',
    phone: '555-123-4567',
  };

  it('rejects unauthenticated saves (401)', async () => {
    const res = await request(app).post('/api/address/save').send(validAddress);
    expect(res.status).toBe(401);
    const count = await addressModel.countDocuments({ email: validAddress.email });
    expect(count).toBe(0); // nothing written
  });

  it('accepts authenticated saves (user token)', async () => {
    const res = await request(app)
      .post('/api/address/save')
      .set('token', tokenB)
      .send(validAddress);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const count = await addressModel.countDocuments({ email: validAddress.email });
    expect(count).toBe(1);
  });
});
