// Phase 1 work area 3 — credential redaction in logs.
// Unit level: redaction helpers. Integration level: connectDB() against an
// unreachable server with a canary password — the canary must never appear
// in console output.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { redactMongoUri, redactError, redactText, summarizeMongoUri } from '../utils/redact.js';
import { globalErrorHandler } from '../app.js';
import connectDB from '../config/mongodb.js';
import mongoose from 'mongoose';

describe('redactMongoUri', () => {
  it('redacts credentials from standard URIs', () => {
    expect(redactMongoUri('mongodb://user:secret@host:27017/db')).toBe(
      'mongodb://***:***@host:27017/db'
    );
  });

  it('redacts credentials from SRV URIs', () => {
    expect(redactMongoUri('mongodb+srv://admin:P@ssw0rd!@cluster.example.net/db')).toBe(
      'mongodb+srv://***:***@cluster.example.net/db'
    );
  });

  it('leaves credential-less URIs untouched', () => {
    expect(redactMongoUri('mongodb://127.0.0.1:27017/db')).toBe('mongodb://127.0.0.1:27017/db');
  });

  it('never echoes non-string input', () => {
    expect(redactMongoUri(undefined)).toBe('');
    expect(redactMongoUri(null)).toBe('');
    expect(redactMongoUri({ uri: 'mongodb://user:pw@host' })).toBe('');
  });
});

describe('redactError', () => {
  it('redacts URIs embedded in error messages', () => {
    const err = new Error('connect ECONNREFUSED mongodb://svc:supersecret@10.0.0.1:27017/e-commerce');
    expect(redactError(err)).not.toContain('supersecret');
    expect(redactError(err)).toContain('***:***@10.0.0.1:27017');
  });

  it('handles strings and null safely', () => {
    expect(redactError('mongodb://a:b@c/d failed')).not.toContain(':b@');
    expect(redactError(null)).toBe('null');
  });
});

describe('redactText (final gate Task 5)', () => {
  it('redacts bearer credentials', () => {
    const out = redactText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('redacts standalone JWT-shaped tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = redactText(`token=${jwt} expired`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('contributes both message AND stack for Error inputs', () => {
    const err = new Error('connect failed');
    err.stack = 'Error: connect failed\n    at f (file.js:1:1)\n    uri mongodb://svc:stacksecret@db.internal:27017/app';
    const out = redactText(err);
    expect(out).toContain('connect failed');
    expect(out).toContain('file.js');
    expect(out).not.toContain('stacksecret');
    expect(out).toContain('***:***@db.internal:27017');
  });

  it('handles non-error input safely', () => {
    expect(redactText(null)).toBe('null');
    expect(redactText(undefined)).toBe('undefined');
    expect(redactText(42)).toBe('42');
  });
});

describe('globalErrorHandler (exported, direct invocation)', () => {
  const reqStub = {};
  const nextStub = () => {};
  let capturedLogs;
  let originalError;

  beforeEach(() => {
    originalError = console.error;
    capturedLogs = [];
    console.error = (...args) => capturedLogs.push(args.map(String).join(' '));
  });

  afterEach(() => {
    console.error = originalError;
  });

  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
  }

  it('returns the same message + a REDACTED stack in non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const err = new Error('boom mongodb://admin:hunter2@prod:27017/app');
      const res = mockRes();
      globalErrorHandler(err, reqStub, res, nextStub);
      expect(res.statusCode).toBe(500);
      expect(res.body.message).not.toContain('hunter2'); // redacted even in dev
      const logged = capturedLogs.join('\n');
      expect(logged).not.toContain('hunter2'); // stack log redacted
      expect(logged).toContain('boom'); // still diagnosable
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('hides the error message entirely in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const err = new Error('secret-token-leak-xyz');
      const res = mockRes();
      globalErrorHandler(err, reqStub, res, nextStub);
      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.message).not.toContain('secret-token-leak');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('keeps mongoose ValidationError semantics (400 + field messages)', () => {
    const err = new mongoose.Error.ValidationError();
    err.errors = { color: { message: 'Color is required' } };
    const res = mockRes();
    globalErrorHandler(err, reqStub, res, nextStub);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Validation Error');
    expect(res.body.errors).toContain('Color is required');
  });

  it('keeps CastError semantics (400 Invalid ID format)', () => {
    const err = new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');
    const res = mockRes();
    globalErrorHandler(err, reqStub, res, nextStub);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Invalid ID format');
  });

  it('keeps duplicate-key semantics (400 Duplicate field value)', () => {
    const err = { name: 'MongoServerError', code: 11000, message: 'E11000 duplicate key' };
    const res = mockRes();
    globalErrorHandler(err, reqStub, res, nextStub);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Duplicate field value');
  });
});

describe('summarizeMongoUri', () => {
  it('shows protocol+host+db but never credentials', () => {
    const summary = summarizeMongoUri('mongodb+srv://user:pass@cluster.net/prod');
    expect(summary).toBe('mongodb+srv://cluster.net/prod');
    expect(summary).not.toContain('pass');
  });
});

describe('connectDB operational logging (integration)', () => {
  const CANARY = 'CANARY-PASSWORD-XYZ';
  let originalUri;
  let capturedLogs;
  let originalLog;
  let originalError;

  beforeEach(() => {
    originalUri = process.env.MONGODB_URI;
    originalLog = console.log;
    originalError = console.error;
    capturedLogs = [];
    console.log = (...args) => capturedLogs.push(args.map(String).join(' '));
    console.error = (...args) => capturedLogs.push(args.map(String).join(' '));
  });

  afterEach(() => {
    process.env.MONGODB_URI = originalUri;
    console.log = originalLog;
    console.error = originalError;
  });

  it('never logs the connection password on failure (canary check)', async () => {
    // Port 1 is unreachable — connection fails with the URI embedded in the
    // error message, exactly the leak this work area fixes. A short
    // serverSelectionTimeoutMS (test-only option) keeps the run fast.
    process.env.MONGODB_URI = `mongodb://logtest:${CANARY}@127.0.0.1:1`;

    await expect(
      connectDB({ serverSelectionTimeoutMS: 1500, socketTimeoutMS: 1500 })
    ).rejects.toThrow();

    const allOutput = capturedLogs.join('\n');
    expect(allOutput).not.toContain(CANARY);
    // But the log still explains what happened (redacted).
    expect(allOutput).toMatch(/MongoDB/);
  });
});
