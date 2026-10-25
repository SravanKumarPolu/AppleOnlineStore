// Traceability-matrix gap: "User registration/login/lockout" had no direct
// backend spec (userController.loginUser/registerUser were only exercised
// incidentally via token fixtures). This file pins the registration and
// login contracts; the lockout state machine is pinned separately in
// userAccountLockout.spec.js.
//
// NOTE: every route under /api/user/* shares the authLimiter (20 requests /
// 15 min / IP). This spec stays well below that budget — keep it that way
// when adding tests.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import app from '../app.js';
import { startTestDb, stopTestDb, createLoginUserDoc } from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;
let inactiveUser;

const uniqueEmail = () => `shopper-${crypto.randomBytes(6).toString('hex')}@example.com`;

beforeAll(async () => {
  db = await startTestDb();
  inactiveUser = await createLoginUserDoc();
  await userModel.findByIdAndUpdate(inactiveUser._id, { isActive: false });
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('POST /api/user/register — registration contract', () => {
  it('creates a user, returns a verifiable token, and never stores the plaintext password', async () => {
    const email = uniqueEmail();
    const res = await request(app).post('/api/user/register').send({
      name: 'New Shopper',
      email,
      password: 'Str0ng!Pass1',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({
      name: 'New Shopper',
      email: email.toLowerCase(),
      role: 'user',
    });

    // The token must be a real, verifiable JWT carrying the new user id.
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(String(decoded.id)).toBe(String(res.body.user.id));

    // Persisted doc: hashed password, default shopper role, active account.
    const saved = await userModel
      .findById(res.body.user.id)
      .select('+password');
    expect(saved).toBeTruthy();
    expect(saved.password).not.toBe('Str0ng!Pass1');
    expect(saved.password.startsWith('$2')).toBe(true); // bcrypt
    expect(saved.role).toBe('user');
    expect(saved.isActive).toBe(true);
  });

  it('rejects a duplicate email with 400', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/user/register')
      .send({ name: 'First User', email, password: 'Str0ng!Pass1' });

    const res = await request(app)
      .post('/api/user/register')
      .send({ name: 'Second User', email, password: 'Str0ng!Pass1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already exists/i);

    const count = await userModel.countDocuments({ email });
    expect(count).toBe(1);
  });

  it('rejects a weak password with 400 and persists nothing', async () => {
    const email = uniqueEmail();
    const res = await request(app).post('/api/user/register').send({
      name: 'Weak Password',
      email,
      password: 'weakpassword',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    const count = await userModel.countDocuments({ email });
    expect(count).toBe(0);
  });

  it('rejects an invalid email with 400 and persists nothing', async () => {
    const res = await request(app).post('/api/user/register').send({
      name: 'Bad Email',
      email: 'not-an-email',
      password: 'Str0ng!Pass1',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await userModel.countDocuments({ email: 'not-an-email' })).toBe(0);
  });
});

describe('POST /api/user/login — login contract', () => {
  it('logs in a registered user and returns a verifiable token', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/user/register')
      .send({ name: 'Login User', email, password: 'Str0ng!Pass1' });

    const res = await request(app)
      .post('/api/user/login')
      .send({ email, password: 'Str0ng!Pass1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({ email: email.toLowerCase(), role: 'user' });

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(String(decoded.id)).toBe(String(res.body.user.id));

    // Successful login updates lastLogin.
    const saved = await userModel.findById(res.body.user.id);
    expect(saved.lastLogin).toBeTruthy();
  });

  it('rejects a wrong password with 401 Invalid credentials', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/user/register')
      .send({ name: 'Wrong Pw', email, password: 'Str0ng!Pass1' });

    const res = await request(app)
      .post('/api/user/login')
      .send({ email, password: 'Wrong!Pass1' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('rejects an unknown email with 401 (same message — no enumeration)', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .send({ email: 'nobody@nowhere.example', password: 'Str0ng!Pass1' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('rejects an inactive (soft-deleted) account with 401', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .send({ email: inactiveUser.email, password: 'TestPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
