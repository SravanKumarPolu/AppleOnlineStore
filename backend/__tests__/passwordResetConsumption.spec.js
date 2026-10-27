// Traceability-matrix gap: the password-reset SEND contract is covered by
// passwordResetEmail.spec.js (K-4), but the resetPassword CONSUMPTION side
// (token verification, password swap, token invalidation) had no spec.
// Tokens are produced through the real model method
// (createPasswordResetToken) so the sha256-hashing round trip is exercised.
//
// NOTE: /api/user/* routes share the authLimiter (20 requests / 15 min / IP);
// this spec uses 7 — keep the budget in mind when adding tests.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcrypt';

import app from '../app.js';
import { startTestDb, stopTestDb, createLoginUserDoc } from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;
let user;
let originalHash;

const NEW_PASSWORD = 'Fresh!Pass22';

const resetPassword = (body) =>
  request(app).post('/api/user/reset-password').send(body);

beforeAll(async () => {
  db = await startTestDb();
  user = await createLoginUserDoc();
  const doc = await userModel.findById(user._id).select('+password');
  originalHash = doc.password;
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/user/reset-password — token consumption', () => {
  it('accepts a valid token, swaps the password, and clears the token', async () => {
    const login = await request(app)
      .post('/api/user/login')
      .send({ email: user.email, password: 'TestPassword123!' });
    expect(login.status).toBe(200);
    const existingSession = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(existingSession.status).toBe(200);

    const rawToken = user.createPasswordResetToken();
    await user.save();

    const res = await resetPassword({ token: rawToken, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const saved = await userModel
      .findById(user._id)
      .select('+password +passwordResetToken +passwordResetExpires');

    // New password works, old password hash is gone.
    expect(await bcrypt.compare(NEW_PASSWORD, saved.password)).toBe(true);
    expect(await bcrypt.compare('TestPassword123!', saved.password)).toBe(false);
    expect(saved.password).not.toBe(originalHash);

    // Single-use: the stored token/expiry are cleared.
    expect(saved.passwordResetToken).toBeFalsy();
    expect(saved.passwordResetExpires).toBeFalsy();

    const staleSession = await request(app)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(staleSession.status).toBe(401);
  });

  it('lets the user log in with the new password afterwards', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .send({ email: user.email, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects the old password on the next login', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .send({ email: user.email, password: 'TestPassword123!' });

    expect(res.status).toBe(401);
  });

  it('rejects an unknown token with 400', async () => {
    const res = await resetPassword({ token: 'a'.repeat(64), newPassword: 'Other!Pass33' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('rejects an expired token with 400', async () => {
    // Produce a raw token through the real model method, then push the stored
    // expiry into the past — the token is well-formed but no longer valid.
    const fresh = await createLoginUserDoc();
    const rawToken = fresh.createPasswordResetToken();
    await fresh.save();
    await userModel.findByIdAndUpdate(fresh._id, {
      $set: { passwordResetExpires: new Date(Date.now() - 60 * 1000) },
    });

    const res = await resetPassword({ token: rawToken, newPassword: 'Other!Pass33' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);

    // The expired token must not change the password.
    const saved = await userModel.findById(fresh._id).select('+password');
    expect(await bcrypt.compare('TestPassword123!', saved.password)).toBe(true);
  });

  it('rejects a weak new password even with a valid token (400, nothing changed)', async () => {
    const fresh = await createLoginUserDoc();
    const rawToken = fresh.createPasswordResetToken();
    await fresh.save();

    const res = await resetPassword({ token: rawToken, newPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 8 characters/i);

    const saved = await userModel.findById(fresh._id).select('+password');
    expect(await bcrypt.compare('TestPassword123!', saved.password)).toBe(true);
  });

  it('rejects a request missing token or password with 400', async () => {
    const res = await resetPassword({ newPassword: 'Other!Pass33' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/token and new password are required/i);
  });
});
