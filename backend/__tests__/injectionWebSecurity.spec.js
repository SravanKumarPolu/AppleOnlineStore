// Phase 3.4 — Injection & web security (OWASP Top 10 / API Security).
//
// Safe, non-destructive probes against the isolated in-memory test instance:
// NoSQL injection, stored XSS payloads, path traversal, header hygiene, CORS,
// unsafe upload types, and sensitive-data exposure.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { startTestDb, stopTestDb, makeAdminToken } from './helpers.mjs';

let db;
let adminToken;

beforeAll(async () => {
  db = await startTestDb();
  adminToken = makeAdminToken();
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('NoSQL injection', () => {
  it('login with $ne / $gt operator objects is rejected (mongoSanitize)', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: { $ne: null }, password: { $gt: '' } }));
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it('login with $regex object is rejected', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: { $regex: '.*', $options: 'i' }, password: { $regex: '.*' } }));
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it('product/single with $where-style payload is rejected as invalid id', async () => {
    const res = await request(app)
      .post('/api/product/single')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ productId: { $gt: '' } }));
    expect(res.status).toBe(400);
  });

  it('category lookups cannot be forced to match everything via regex metacharacters', async () => {
    // `new RegExp('^' + name + '$', 'i')` with name = '.*' would match ANY
    // category if unescaped — enabling duplicate-name bypass. The controller
    // must escape metacharacters (or match exactly).
    await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ name: 'Real Category', description: 'legit' });

    const res = await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ name: '.*', description: 'should not collide' });
    // If '.*' were interpreted as a regex, it would collide with 'Real Category'
    // and be rejected as duplicate (or worse, update it). Expected: either a
    // clean 4xx for invalid characters, or 201 with a literal '.*' category
    // that is DISTINCT from 'Real Category'.
    expect(res.status).toBeLessThan(500);
    if (res.status < 400) {
      const list = await request(app).get('/api/category/list');
      const names = (list.body.categories || list.body.data || list.body || []).map(
        (c) => c.name
      );
      expect(names).toContain('Real Category');
      expect(names).toContain('.*'); // stored literally, not as a wildcard
    }
  });
});

describe('stored XSS hygiene', () => {
  it('registration blocks or inertly stores script payloads (never executes server-side)', async () => {
    const xss = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const res = await request(app).post('/api/user/register').send({
      name: xss,
      email: `xss-${Date.now()}@example.com`,
      password: 'Str0ng!Pass1',
    });
    // Acceptance: EITHER a clean 400 rejection (name validator: letters+spaces
    // only) OR storage as inert text. Never a 500, never an executed payload.
    expect(res.status).toBeLessThan(500);
    if (res.status >= 400) {
      expect(res.body.token).toBeUndefined(); // rejected → no token issued
    }
    // The API must serve JSON, never HTML.
    expect(String(res.headers['content-type'])).toMatch(/application\/json/);
  });

  it('category names with HTML payloads are stored as text, served as JSON', async () => {
    const res = await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ name: '<svg onload=alert(1)>', description: '<b>bold</b>' });
    expect(res.status).toBeLessThan(500);
    if (res.status < 400) {
      const list = await request(app).get('/api/category/list');
      expect(String(list.headers['content-type'])).toMatch(/application\/json/);
    }
  });
});

describe('path traversal & unsafe uploads', () => {
  it('multer rejects non-image content types on product add', async () => {
    const res = await request(app)
      .post('/api/product/add')
      .set('token', adminToken)
      .field('name', 'Evil Product')
      .field('description', 'x')
      .field('price', '10')
      .field('category', 'iPhone')
      .field('subCategory', 'Pro')
      .field('color', 'Black')
      .attach('image1', Buffer.from('#!/bin/sh\necho pwned', 'utf-8'), {
        filename: 'shell.sh',
        contentType: 'application/x-sh',
      });
    expect([400, 500]).toContain(res.status); // multer error handler returns 400
    if (res.status === 400) {
      expect(res.body.success).toBe(false);
    }
  });

  it('multer rejects files above the 5 MB limit', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await request(app)
      .post('/api/product/add')
      .set('token', adminToken)
      .field('name', 'Big Product')
      .field('description', 'x')
      .field('price', '10')
      .field('category', 'iPhone')
      .field('subCategory', 'Pro')
      .field('color', 'Black')
      .attach('image1', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('no static file serving is mounted (uploads dir unreachable)', async () => {
    const probes = [
      '/uploads/../server.js',
      '/uploads/../../etc/passwd',
      '/static/../.env',
      '/images/../backend/.env',
    ];
    for (const p of probes) {
      const res = await request(app).get(encodeURI(p));
      expect(res.status).toBe(404);
      expect(res.text || '').not.toContain('MONGODB_URI');
    }
  });
});

describe('security headers & CORS', () => {
  it('sets helmet security headers on API responses', async () => {
    const res = await request(app).get('/health/live');
    const h = res.headers;
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBeDefined();
    expect(h['content-security-policy']).toBeDefined();
    expect(String(h['content-security-policy'])).not.toMatch(/unsafe-eval/);
  });

  it('rejects cross-origin requests from unlisted origins', async () => {
    const res = await request(app)
      .get('/api/product/list')
      .set('Origin', 'https://evil-attacker.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows listed origins with credentials', async () => {
    const res = await request(app)
      .get('/api/product/list')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('sensitive data exposure', () => {
  it('API responses never include password hashes', async () => {
    const res = await request(app)
      .post('/api/user/register')
      .send({ name: 'Leak Check', email: `leak-${Date.now()}@example.com`, password: 'Str0ng!Pass1' });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/"password"\s*:/);
    expect(serialized).not.toMatch(/\$2[aby]\$12/);
  });

  it('health endpoints do not leak secrets (URIs, keys)', async () => {
    for (const path of ['/health/live', '/health/ready', '/health']) {
      const res = await request(app).get(path);
      expect(JSON.stringify(res.body)).not.toContain(process.env.JWT_SECRET);
      expect(JSON.stringify(res.body)).not.toMatch(/mongodb(\+srv)?:\/\//);
    }
  });

  it('user profile does not expose reset tokens or login counters', async () => {
    const { createTestUserDoc, makeUserToken } = await import('./helpers.mjs');
    const u = await createTestUserDoc('user');
    const res = await request(app).get('/api/user/profile').set('token', makeUserToken(u._id));
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('passwordResetToken');
    expect(serialized).not.toContain('loginAttempts');
  });
});

describe('CSRF posture (token-header auth)', () => {
  it('auth comes from a custom header — cross-site form posts cannot authenticate', async () => {
    // A CSRF attack relies on ambient credentials (cookies). This API only
    // accepts `token`/`Authorization` headers, which cross-site forms cannot
    // set. Verify a request WITHOUT the header is always 401 even when a
    // `token` FIELD is present in the body (the server must not read it).
    const res = await request(app)
      .post('/api/orders/userorders')
      .send({ token: 'irrelevant-body-token', page: 1 });
    expect(res.status).toBe(401);
  });
});
