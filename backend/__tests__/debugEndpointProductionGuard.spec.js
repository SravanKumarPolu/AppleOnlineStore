// Phase 4 regression — debug endpoints cannot expose data in production.
//
// /api/user/debug and /api/orders/debug are admin-only diagnostics that dump
// user and order PII. No frontend/admin code calls them (verified by grep),
// so the corrected policy is:
//   - non-production (development/test/staging): admin-only, as before
//   - NODE_ENV=production: DISABLED (404) unless ENABLE_DEBUG_ENDPOINTS=true
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { startTestDb, stopTestDb, makeAdminToken, makeUserToken, createTestUserDoc } from './helpers.mjs';

let db;
let adminToken;
let userToken;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ENABLE_DEBUG = process.env.ENABLE_DEBUG_ENDPOINTS;

beforeAll(async () => {
  db = await startTestDb();
  const user = await createTestUserDoc('user');
  adminToken = makeAdminToken();
  userToken = makeUserToken(user._id);
});

afterAll(async () => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ENABLE_DEBUG === undefined) delete process.env.ENABLE_DEBUG_ENDPOINTS;
  else process.env.ENABLE_DEBUG_ENDPOINTS = ORIGINAL_ENABLE_DEBUG;
  await stopTestDb(db);
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV || 'test';
  if (ORIGINAL_ENABLE_DEBUG === undefined) delete process.env.ENABLE_DEBUG_ENDPOINTS;
  else process.env.ENABLE_DEBUG_ENDPOINTS = ORIGINAL_ENABLE_DEBUG;
});

describe('debug endpoints in non-production (unchanged admin-only behavior)', () => {
  it('rejects unauthenticated access with 401', async () => {
    process.env.NODE_ENV = 'test';
    expect((await request(app).get('/api/user/debug')).status).toBe(401);
    expect((await request(app).get('/api/orders/debug')).status).toBe(401);
  });

  it('rejects non-admin authenticated access with 403', async () => {
    process.env.NODE_ENV = 'test';
    expect((await request(app).get('/api/user/debug').set('token', userToken)).status).toBe(403);
    expect((await request(app).get('/api/orders/debug').set('token', userToken)).status).toBe(403);
  });

  it('serves admin tokens with 200', async () => {
    process.env.NODE_ENV = 'test';
    expect((await request(app).get('/api/user/debug').set('token', adminToken)).status).toBe(200);
    expect((await request(app).get('/api/orders/debug').set('token', adminToken)).status).toBe(200);
  });
});

describe('debug endpoints under NODE_ENV=production', () => {
  it('respond 404 for everyone (even admins) when disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_DEBUG_ENDPOINTS;

    expect((await request(app).get('/api/user/debug')).status).toBe(404);
    expect((await request(app).get('/api/orders/debug')).status).toBe(404);
    expect((await request(app).get('/api/user/debug').set('token', adminToken)).status).toBe(404);
    expect((await request(app).get('/api/orders/debug').set('token', adminToken)).status).toBe(404);
  });

  it('can be explicitly re-enabled with ENABLE_DEBUG_ENDPOINTS=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEBUG_ENDPOINTS = 'true';

    expect((await request(app).get('/api/user/debug').set('token', adminToken)).status).toBe(200);
    expect((await request(app).get('/api/orders/debug').set('token', adminToken)).status).toBe(200);
    // ...still admin-only, and still closed to shoppers:
    expect((await request(app).get('/api/user/debug').set('token', userToken)).status).toBe(403);
  });

  it('ENABLE_DEBUG_ENDPOINTS values other than "true" keep them disabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEBUG_ENDPOINTS = 'yes';

    expect((await request(app).get('/api/user/debug').set('token', adminToken)).status).toBe(404);
  });
});
