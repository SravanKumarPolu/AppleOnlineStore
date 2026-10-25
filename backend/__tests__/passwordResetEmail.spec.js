// K-4 fix regression suite — the password reset email must be invoked with
// (email, name, resetToken) and must render a correct, clickable reset link.
// Before the fix userController passed (email, resetToken, resetUrl): the raw
// token landed in the greeting slot and the reset link was malformed.
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import emailService from '../services/emailService.js';
import { startTestDb, stopTestDb, createTestUserDoc } from './helpers.mjs';

let db;
let user;
// The real service method, bound to the singleton (restored in afterAll).
const realSendPasswordResetEmail = emailService.sendPasswordResetEmail.bind(
  emailService
);

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
});

afterAll(async () => {
  emailService.sendPasswordResetEmail = realSendPasswordResetEmail;
  await stopTestDb(db);
});

describe('POST /api/user/forgot-password — service call contract (K-4 fix)', () => {
  it('calls the email service with (email, name, resetToken)', async () => {
    const sendMock = jest.fn().mockResolvedValue(true);
    emailService.sendPasswordResetEmail = sendMock;

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: user.email });

    expect(res.status).toBe(200);
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

  it('still answers 200 without revealing existence for unknown emails', async () => {
    emailService.sendPasswordResetEmail = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .post('/api/user/forgot-password')
      .send({ email: 'nobody@nowhere.example' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe('emailService.sendPasswordResetEmail — rendered email (K-4 fix)', () => {
  it('greets the user by name and builds the reset link from FRONTEND_URL + token', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-message-id' });
    // Inject a fake transport — no SMTP/network involved.
    emailService.transporter = { sendMail };

    await realSendPasswordResetEmail(
      'dest@example.com',
      'Alice',
      'token-abc-123'
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('dest@example.com');
    expect(mail.subject).toBe('Password Reset Request');

    const expectedLink = `${
      process.env.FRONTEND_URL || 'http://localhost:5173'
    }/reset-password?token=token-abc-123`;
    expect(mail.html).toContain('Hello Alice,');
    expect(mail.html).toContain(`href="${expectedLink}"`);
    expect(mail.html).toContain(expectedLink);
  });
});
