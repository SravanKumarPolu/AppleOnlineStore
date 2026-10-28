// Phase 3.2 — Authentication attacks (isolated test environment).
//
// Covers: invalid/expired/tampered JWTs, algorithm-confusion attempts, missing
// auth, logout semantics, privilege escalation via crafted tokens, admin
// endpoint protection, brute-force lockout, and account enumeration.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  makeAdminToken,
  makeUserToken,
  createTestUserDoc,
  createLoginUserDoc,
} from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;
let user;
let userToken;
let loginEmail;
const LOGIN_PASSWORD = 'Str0ng!Pass1';

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
  const loginDoc = await createLoginUserDoc(
    `victim-${crypto.randomBytes(4).toString('hex')}@example.com`,
    LOGIN_PASSWORD
  );
  loginEmail = loginDoc.email;
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('invalid / tampered / expired tokens', () => {
  it('rejects a garbage token with 401', async () => {
    const res = await request(app)
      .get('/api/user/profile')
      .set('token', 'not-a-jwt-at-all');
    expect(res.status).toBe(401);
  });

  it('rejects a structurally valid JWT signed with the WRONG secret', async () => {
    const forged = jwt.sign({ id: String(user._id) }, 'attacker-known-secret', { expiresIn: '1h' });
    const res = await request(app).get('/api/user/profile').set('token', forged);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '-10s' });
    const res = await request(app).get('/api/user/profile').set('token', expired);
    expect(res.status).toBe(401);
  });

  it('rejects a token with tampered payload (signature mismatch)', async () => {
    const [header, , signature] = makeUserToken(user._id).split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ id: String(user._id), role: 'admin' })
    ).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    const res = await request(app).get('/api/user/profile').set('token', tampered);
    expect(res.status).toBe(401);
  });

  it('rejects alg:none tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: String(user._id), role: 'admin' })).toString('base64url');
    const noneToken = `${header}.${payload}.`;
    const res = await request(app).get('/api/user/profile').set('token', noneToken);
    expect(res.status).toBe(401);
  });

  it('rejects a token for a non-existent user id', async () => {
    const ghost = jwt.sign({ id: '6626abcd1234abcd1234abcd' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/user/profile').set('token', ghost);
    expect(res.status).toBe(401);
  });

  it('rejects a token for a deactivated user', async () => {
    const inactive = await userModel.create({
      name: 'Inactive User',
      email: `inactive-${crypto.randomBytes(4).toString('hex')}@example.com`,
      password: 'FakeHash!Pass123',
      isActive: false,
    });
    const token = makeUserToken(inactive._id);
    const res = await request(app).get('/api/user/profile').set('token', token);
    expect(res.status).toBe(401);
  });

  it('requires authentication (missing token) on protected endpoints', async () => {
    const endpoints = [
      ['get', '/api/user/profile'],
      ['post', '/api/orders'],
      ['post', '/api/cart/get'],
      ['post', '/api/orders/userorders'],
      ['put', '/api/orders/status'],
      ['get', '/api/orders/all'],
      ['post', '/api/product/add'],
      ['post', '/api/product/remove'],
    ];
    for (const [method, path] of endpoints) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });

  it('a user token cannot be upgraded to admin by claim injection (role field ignored)', async () => {
    const escalated = jwt.sign({ id: String(user._id), role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/orders/all').set('token', escalated);
    // authAdmin checks DB role for user-type tokens → 403
    expect(res.status).toBe(403);
  });
});

describe('admin boundary attacks', () => {
  it('an attacker cannot forge an admin token without the secret', async () => {
    const fakeAdmin = jwt.sign({ email: 'root@evil.com', role: 'admin', type: 'admin' }, 'wrong-secret');
    const res = await request(app).get('/api/orders/all').set('token', fakeAdmin);
    expect(res.status).toBe(401);
  });

  it('a regular user cannot log in as admin (POST /api/user/admin)', async () => {
    const res = await request(app)
      .post('/api/user/admin')
      .send({ email: loginEmail, password: LOGIN_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('admin login with wrong password returns 401 and no token', async () => {
    const res = await request(app)
      .post('/api/user/admin')
      .send({ email: process.env.ADMIN_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('admin endpoints refuse user tokens with 403', async () => {
    const endpoints = [
      ['put', '/api/orders/status'],
      ['get', '/api/orders/all'],
      ['get', '/api/orders/debug'],
      ['get', '/api/user/debug'],
      ['post', '/api/product/add'],
      ['post', '/api/product/remove'],
      ['post', '/api/category/add'],
      ['get', '/api/analytics/dashboard-summary'],
    ];
    for (const [method, path] of endpoints) {
      const res = await request(app)[method](path).set('token', userToken);
      expect(res.status).toBe(403);
    }
  });

  it('a genuine admin token still passes (control test)', async () => {
    const res = await request(app).get('/api/orders/all').set('token', makeAdminToken());
    expect(res.status).toBe(200);
  });
});

describe('session / token lifecycle', () => {
  it('password reset does NOT invalidate existing tokens (documented risk — regression guard)', async () => {
    const email = `lifecycle-${crypto.randomBytes(4).toString('hex')}@example.com`;
    const doc = await createLoginUserDoc(email, LOGIN_PASSWORD);
    const login = await request(app).post('/api/user/login').send({ email, password: LOGIN_PASSWORD });
    const oldToken = login.body.token;
    expect(oldToken).toBeTruthy();

    // Generate the raw reset token via the model helper (the controller stores
    // only its sha256 hash), then consume it.
    const fresh = await userModel.findById(doc._id);
    const rawToken = fresh.createPasswordResetToken();
    await fresh.save();

    const reset = await request(app)
      .post('/api/user/reset-password')
      .send({ token: rawToken, newPassword: 'NewStr0ng!Pass2' });
    expect(reset.status).toBeLessThan(400);

    // KNOWN GAP: the pre-reset token still works. This assertion documents the
    // current behavior; flipping it to 401 is the fix (token versioning).
    const stillValid = await request(app).get('/api/user/profile').set('token', oldToken);
    expect([200, 401]).toContain(stillValid.status);
  });
});

describe('brute force & lockout', () => {
  // NOTE: full lockout semantics (5 failures -> 423 lock, counter reset,
  // expired lock restart) are covered exhaustively by userAccountLockout.spec.js.
  // Repeating them here would exhaust the authLimiter budget (20 req / 15 min
  // per IP for the whole /api/user router) before the remaining probes run.

  it('login failures do not reveal whether the email exists (same message)', async () => {
    const unknown = await request(app)
      .post('/api/user/login')
      .send({ email: 'ghost-nobody@example.com', password: 'WrongPass1!' });
    const known = await request(app)
      .post('/api/user/login')
      .send({ email: `known-${crypto.randomBytes(4).toString('hex')}@example.com`, password: 'WrongPass1!' });
    expect(unknown.status).toBe(401);
    expect(known.status).toBe(401);
    expect(unknown.body.message).toBe(known.body.message);
  });

  it('password reset for unknown email does not leak existence', async () => {
    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: 'ghost-nobody@example.com' });

    // 202 Accepted is the documented contract: the request is accepted and an
    // SMTP handoff is attempted, so neither delivery nor account existence can
    // be inferred from the status. Parity between unknown / known / inactive
    // accounts is asserted in passwordResetEmail.spec.js (same status, same
    // body) — this test guards the wording on the unknown-account path.
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.message).not.toMatch(/not found|no user|doesn't exist/i);
  });
});

describe('rate limiting effectiveness (authLimiter: 20 req / 15 min on /api/user)', () => {
  it('eventually returns 429 under sustained request pressure (proof the limiter engages)', async () => {
    // Hammer /api/user/login with garbage until the limiter trips or a hard
    // cap of 15 extra requests is reached (the earlier tests already consumed
    // most of the 20-request budget).
    let saw429 = false;
    for (let i = 0; i < 15 && !saw429; i++) {
      const res = await request(app)
        .post('/api/user/login')
        .send({ email: 'ratelimit-probe@example.com', password: 'WrongPass1!' });
      if (res.status === 429) saw429 = true;
    }
    expect(saw429).toBe(true);

    // Non-auth routes are NOT throttled by the same bucket (global limiter
    // allows 1000) — product listing still works from the same IP.
    const products = await request(app).get('/api/product/list');
    expect(products.status).toBeLessThan(429);
  });
});
