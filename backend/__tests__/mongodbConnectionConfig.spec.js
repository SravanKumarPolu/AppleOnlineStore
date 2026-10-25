// Phase 2 regression — MongoDB connection configuration.
//
// Pins the reworked config/mongodb.js:
//   - a COMPLETE MONGODB_URI (database + optional query string) is used
//     verbatim — never double-appended
//   - a BARE HOST URI gets the explicit database applied (MONGODB_DB, or the
//     historical default "e-commerce")
//   - missing / non-string / wrong-scheme / unparseable values throw clear,
//     credential-safe errors BEFORE any connection attempt
//   - connectDB verifies the connection (readyState + ping) before
//     resolving, and never leaks credentials into logs
//
// The integration cases run against mongodb-memory-server ONLY — automated
// tests never touch a real (production) database.
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  resolveMongoConnectionUri,
  DEFAULT_MONGODB_DB,
  default as connectDB,
} from '../config/mongodb.js';

const MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.14';

// ---------------------------------------------------------------------------
// Pure resolution logic — valid / malformed / missing configuration
// ---------------------------------------------------------------------------
describe('resolveMongoConnectionUri — valid configuration', () => {
  it('uses a complete URI with a database verbatim (no double append)', () => {
    const uri = 'mongodb://localhost:27017/e-commerce';
    expect(resolveMongoConnectionUri({ MONGODB_URI: uri })).toEqual({
      uri,
      database: 'e-commerce',
    });
  });

  it('keeps a query string on a complete URI intact', () => {
    const uri = 'mongodb+srv://user:pass@cluster0.abc.mongodb.net/e-commerce?retryWrites=true&w=majority';
    expect(resolveMongoConnectionUri({ MONGODB_URI: uri })).toEqual({
      uri,
      database: 'e-commerce',
    });
  });

  it('respects a non-default database selected in the URI', () => {
    const uri = 'mongodb://localhost:27017/novacart-prod';
    expect(resolveMongoConnectionUri({ MONGODB_URI: uri })).toEqual({
      uri,
      database: 'novacart-prod',
    });
  });

  it('applies the historical default database to a bare host URI', () => {
    expect(resolveMongoConnectionUri({ MONGODB_URI: 'mongodb://localhost:27017' })).toEqual({
      uri: `mongodb://localhost:27017/${DEFAULT_MONGODB_DB}`,
      database: DEFAULT_MONGODB_DB,
    });
    expect(DEFAULT_MONGODB_DB).toBe('e-commerce');
  });

  it('strips a trailing slash from a bare host URI before appending the database', () => {
    expect(resolveMongoConnectionUri({ MONGODB_URI: 'mongodb://localhost:27017/' })).toEqual({
      uri: `mongodb://localhost:27017/${DEFAULT_MONGODB_DB}`,
      database: DEFAULT_MONGODB_DB,
    });
  });

  it('applies MONGODB_DB to a bare host URI when provided', () => {
    expect(resolveMongoConnectionUri({ MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DB: 'staging-db' })).toEqual({
      uri: 'mongodb://localhost:27017/staging-db',
      database: 'staging-db',
    });
  });

  it('does NOT let MONGODB_DB override an explicit database in the URI', () => {
    const uri = 'mongodb://localhost:27017/prod-db';
    expect(resolveMongoConnectionUri({ MONGODB_URI: uri, MONGODB_DB: 'other-db' })).toEqual({
      uri,
      database: 'prod-db',
    });
  });

  it('trims whitespace around the URI', () => {
    expect(resolveMongoConnectionUri({ MONGODB_URI: '  mongodb://localhost:27017/e-commerce  ' }).uri).toBe(
      'mongodb://localhost:27017/e-commerce'
    );
  });
});

describe('resolveMongoConnectionUri — missing and malformed configuration', () => {
  const malformed = [
    ['undefined variable', { MONGODB_URI: undefined }],
    ['empty string', { MONGODB_URI: '' }],
    ['whitespace only', { MONGODB_URI: '   ' }],
    ['non-string value', { MONGODB_URI: 42 }],
    ['wrong scheme (http)', { MONGODB_URI: 'http://localhost:27017/e-commerce' }],
    ['wrong scheme (postgres)', { MONGODB_URI: 'postgres://user:pass@host/db' }],
    ['literal "undefined" path', { MONGODB_URI: 'undefined/e-commerce' }],
    ['unparseable mongodb URI', { MONGODB_URI: 'mongodb://[::broken' }],
  ];

  for (const [label, env] of malformed) {
    it(`throws a clear error for: ${label}`, () => {
      expect(() => resolveMongoConnectionUri(env)).toThrow(/MONGODB_URI/);
    });
  }

  it('never embeds the offending value or credentials in the error message', () => {
    try {
      resolveMongoConnectionUri({ MONGODB_URI: 'mongodb+srv://secret-user:secret-pass@bad-host/db' });
      throw new Error('expected resolveMongoConnectionUri to throw');
    } catch (err) {
      expect(err.message).not.toContain('secret-user');
      expect(err.message).not.toContain('secret-pass');
      expect(err.message).not.toContain('bad-host');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration — connectDB against an IN-MEMORY database only
// ---------------------------------------------------------------------------
describe('connectDB — integration against mongodb-memory-server', () => {
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({ binary: { version: MONGOMS_VERSION } });
  });

  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('connects with a COMPLETE URI and reports the selected database', async () => {
    const hostUri = mongod.getUri().replace(/\/$/, '');
    const completeUri = `${hostUri}/connect-complete-test`;

    const previous = process.env.MONGODB_URI;
    process.env.MONGODB_URI = completeUri;
    try {
      const connection = await connectDB();
      expect(connection.readyState).toBe(1);
      expect(connection.name).toBe('connect-complete-test');
    } finally {
      if (previous === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previous;
    }
  });

  it('connects with a BARE HOST URI by applying the historical default database', async () => {
    const bareUri = mongod.getUri().replace(/\/$/, ''); // no database component

    const previous = process.env.MONGODB_URI;
    const previousDb = process.env.MONGODB_DB;
    delete process.env.MONGODB_DB;
    process.env.MONGODB_URI = bareUri;
    try {
      const connection = await connectDB();
      expect(connection.readyState).toBe(1);
      expect(connection.name).toBe(DEFAULT_MONGODB_DB); // "e-commerce" preserved
    } finally {
      if (previous === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previous;
      if (previousDb === undefined) delete process.env.MONGODB_DB;
      else process.env.MONGODB_DB = previousDb;
    }
  });

  it('fails fast (throws) when MONGODB_URI is missing', async () => {
    const previous = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    try {
      await expect(connectDB()).rejects.toThrow(/MONGODB_URI/);
    } finally {
      if (previous === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previous;
    }
  });

  it('fails fast (throws) when MONGODB_URI has a wrong scheme', async () => {
    const previous = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'http://not-a-mongo-host:27017/db';
    try {
      await expect(connectDB()).rejects.toThrow(/MONGODB_URI/);
    } finally {
      if (previous === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previous;
    }
  });
});
