// Traceability-matrix gap: userModel's account-lockout machinery
// (incrementLoginAttempts / resetLoginAttempts / isLocked virtual) had no
// direct spec. Pins the state machine through the real login endpoint:
//   - 5 consecutive failures lock the account for 2 hours (423 afterwards)
//   - an EXPIRED lock restarts the counter at 1 instead of re-locking
//   - a successful login clears the counter entirely
//
// NOTE: /api/user/* routes share the authLimiter (20 requests / 15 min / IP);
// this spec uses 11 — keep the budget in mind when adding tests.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { startTestDb, stopTestDb, createLoginUserDoc } from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;

const login = (email, password) =>
  request(app).post('/api/user/login').send({ email, password });

const getLockState = async (userId) =>
  userModel.findById(userId).select('+loginAttempts +lockUntil');

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/user/login — account lockout state machine', () => {
  it('locks the account after 5 consecutive failures and rejects even the correct password (423)', async () => {
    const user = await createLoginUserDoc();

    // Failures 1..4: plain 401s, account not yet locked.
    for (let i = 1; i <= 4; i++) {
      const res = await login(user.email, 'Totally-Wrong-1!');
      expect(res.status).toBe(401);
      const state = await getLockState(user._id);
      expect(state.loginAttempts).toBe(i);
      expect(state.lockUntil).toBeFalsy();
    }

    // Failure 5: the counter hits the threshold and sets a future lock.
    const fifth = await login(user.email, 'Totally-Wrong-1!');
    expect(fifth.status).toBe(401);
    const afterFifth = await getLockState(user._id);
    expect(afterFifth.loginAttempts).toBe(5);
    expect(afterFifth.lockUntil).toBeTruthy();
    expect(afterFifth.lockUntil.getTime()).toBeGreaterThan(Date.now());

    // Even the CORRECT password is rejected while locked.
    const locked = await login(user.email, 'TestPassword123!');
    expect(locked.status).toBe(423);
    expect(locked.body.success).toBe(false);
    expect(locked.body.message).toMatch(/locked/i);

    // The failed locked attempt must not extend the lock window.
    const afterLocked = await getLockState(user._id);
    expect(afterLocked.lockUntil.getTime()).toBe(afterFifth.lockUntil.getTime());
  });

  it('restarts the counter at 1 when a previous lock has expired', async () => {
    const user = await createLoginUserDoc();

    // Simulate a lock that was set in the past and has since expired.
    await userModel.findByIdAndUpdate(user._id, {
      $set: {
        loginAttempts: 4,
        lockUntil: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    // isLocked is false (lock in the past) -> normal 401 path.
    const res = await login(user.email, 'Totally-Wrong-1!');
    expect(res.status).toBe(401);

    // incrementLoginAttempts took the expired-lock branch: counter restarted
    // at 1 and the stale lockUntil was cleared.
    const state = await getLockState(user._id);
    expect(state.loginAttempts).toBe(1);
    expect(state.lockUntil).toBeFalsy();
  });

  it('clears the attempt counter on a successful login', async () => {
    const user = await createLoginUserDoc();

    for (let i = 0; i < 3; i++) {
      const res = await login(user.email, 'Totally-Wrong-1!');
      expect(res.status).toBe(401);
    }
    let state = await getLockState(user._id);
    expect(state.loginAttempts).toBe(3);

    const ok = await login(user.email, 'TestPassword123!');
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);

    state = await getLockState(user._id);
    expect(state.loginAttempts).toBeFalsy();
    expect(state.lockUntil).toBeFalsy();
  });
});
