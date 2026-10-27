// K-4 fix regression suite — the password reset email must be invoked with
// (email, name, resetToken) and must render a correct, clickable reset link.
// Before the fix userController passed (email, resetToken, resetUrl): the raw
// token landed in the greeting slot and the reset link was malformed.
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import emailService from '../services/emailService.js';
import { startTestDb, stopTestDb, createTestUserDoc } from './helpers.mjs';
import userModel from '../models/userModel.js';

let db;
let user;
const originalTransporter = emailService.transporter;
const originalTransportReady = emailService.transportReady;
const realSendPasswordResetEmail = emailService.sendPasswordResetEmail.bind(
  emailService
);
const genericResponseMessage =
  "If an account exists for this email, we'll attempt to send a reset link.";

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
});

afterAll(async () => {
  await stopTestDb(db);
});

afterEach(() => {
  emailService.sendPasswordResetEmail = realSendPasswordResetEmail;
  emailService.transporter = originalTransporter;
  emailService.transportReady = originalTransportReady;
});

describe('POST /api/user/forgot-password — service call contract (K-4 fix)', () => {
  it('calls the email service with (email, name, resetToken)', async () => {
    const sendMock = jest.fn().mockResolvedValue(true);
    emailService.sendPasswordResetEmail = sendMock;

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: user.email });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const [toEmail, nameArg, tokenArg] = sendMock.mock.calls[0];
    expect(toEmail).toBe(user.email);
    // The NAME slot must receive the user's name — with the old bug the raw
    // 64-char hex reset token landed here (greeting read "Hello a1b2…").
    expect(nameArg).toBe(user.name);
    expect(nameArg).not.toMatch(/^[a-f0-9]{64}$/);
    // The TOKEN slot must receive the raw hex token — with the old bug a full
    // URL string landed here and the emailed link was malformed.
    expect(tokenArg).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenArg).not.toContain('/');
  });

  it('uses the same 202 response without revealing existence for unknown emails', async () => {
    emailService.sendPasswordResetEmail = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: 'nobody@nowhere.example' });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe(genericResponseMessage);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('uses the same response for inactive accounts', async () => {
    const inactiveUser = await createTestUserDoc('user');
    inactiveUser.isActive = false;
    await inactiveUser.save();
    const sendMock = jest.fn();
    emailService.sendPasswordResetEmail = sendMock;

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: inactiveUser.email });

    expect(res.status).toBe(202);
    expect(res.body.message).toBe(genericResponseMessage);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('clears the pending token and keeps the response enumeration-safe when SMTP is missing', async () => {
    emailService.transporter = null;
    emailService.transportReady = Promise.resolve(false);

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: user.email });

    const saved = await userModel
      .findById(user._id)
      .select('+passwordResetToken +passwordResetExpires');
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(genericResponseMessage);
    expect(saved.passwordResetToken).toBeFalsy();
    expect(saved.passwordResetExpires).toBeFalsy();
  });

  it('clears the pending token after SMTP authentication failure', async () => {
    const sendMail = jest.fn().mockRejectedValue(
      Object.assign(new Error('authentication rejected'), { code: 'EAUTH' })
    );
    emailService.transporter = { sendMail };
    emailService.transportReady = Promise.resolve(true);

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: user.email });

    const saved = await userModel
      .findById(user._id)
      .select('+passwordResetToken +passwordResetExpires');
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(genericResponseMessage);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(saved.passwordResetToken).toBeFalsy();
    expect(saved.passwordResetExpires).toBeFalsy();
  });

  it('returns the neutral accepted response after simulated successful SMTP handoff', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'synthetic-message-id' });
    emailService.transporter = { sendMail };
    emailService.transportReady = Promise.resolve(true);

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: user.email });

    const saved = await userModel
      .findById(user._id)
      .select('+passwordResetToken +passwordResetExpires');
    expect(res.status).toBe(202);
    expect(res.body.message).toBe(genericResponseMessage);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(saved.passwordResetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.passwordResetExpires.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('emailService.sendPasswordResetEmail — rendered email (K-4 fix)', () => {
  it('greets the user by name and builds the reset link from FRONTEND_URL + token', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-message-id' });
    // Inject a fake transport — no SMTP/network involved.
    emailService.transporter = { sendMail };
    emailService.transportReady = Promise.resolve(true);

    await realSendPasswordResetEmail(
      'dest@example.com',
      'Alice',
      'token-abc-123'
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('dest@example.com');
    expect(mail.subject).toBe('Password Reset Request');

    const expectedUrl = new URL(
      '/reset-password',
      process.env.FRONTEND_URL || 'http://localhost:5173'
    );
    expectedUrl.searchParams.set('token', 'token-abc-123');
    const expectedLink = expectedUrl.toString();
    expect(mail.html).toContain('Hello Alice,');
    expect(mail.html).toContain(`href="${expectedLink}"`);
    expect(mail.html).toContain(expectedLink);
  });
});
