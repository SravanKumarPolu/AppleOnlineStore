// Phase 1 work area 5 — health endpoints (liveness / readiness).
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';

import app, { setShuttingDown, isShuttingDown } from '../app.js';
import { startTestDb } from './helpers.mjs';

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  // Leave mongoose disconnected cleanly for the disconnect case's afterlife.
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await db.mongod.stop();
});

describe('GET /health/live', () => {
  it('returns 200 with process liveness only', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('live');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when the database is connected', async () => {
    expect(mongoose.connection.readyState).toBe(1);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe(true);
  });

  it('returns 503 when the database is disconnected', async () => {
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).toBe(0);

    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not ready');
    expect(res.body.checks.database).toBe(false);
  });

  it('never exposes secrets or connection strings', async () => {
    await mongoose.connect(db.uri);
    for (const path of ['/health/live', '/health/ready', '/health']) {
      const res = await request(app).get(path);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/mongodb(\+srv)?:\/\//i);
      expect(body).not.toMatch(/JWT_SECRET|PASSWORD|SECRET_KEY|CLIENT_SECRET/i);
      expect(body).not.toMatch(/process\.env/);
    }
  });
});

describe('GET /health/ready during graceful shutdown (final gate Task 2)', () => {
  it('returns 503 for the whole drain window even while MongoDB is still connected', async () => {
    // The database IS connected — this is exactly the case the old endpoint
    // got wrong (it reported 200-ready during shutdown).
    await mongoose.connect(db.uri);
    expect(mongoose.connection.readyState).toBe(1);

    setShuttingDown(true);
    try {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not ready');
      expect(res.body.checks.shuttingDown).toBe(true);
      // Honest reporting: the database check itself is still true.
      expect(res.body.checks.database).toBe(true);
    } finally {
      setShuttingDown(false);
    }

    // And the endpoint recovers once the drain flag clears.
    const recovered = await request(app).get('/health/ready');
    expect(recovered.status).toBe(200);
  });

  it('reports 503 with database down AND draining (composed failure)', async () => {
    await mongoose.disconnect();
    setShuttingDown(true);
    try {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.checks.database).toBe(false);
      expect(res.body.checks.shuttingDown).toBe(true);
    } finally {
      setShuttingDown(false);
      await mongoose.connect(db.uri);
    }
  });

  it('exposes the drain state via isShuttingDown()', () => {
    expect(isShuttingDown()).toBe(false);
    setShuttingDown(true);
    expect(isShuttingDown()).toBe(true);
    setShuttingDown(false);
    expect(isShuttingDown()).toBe(false);
  });
});

describe('legacy GET /health (backward compatibility)', () => {
  it('still returns 200 with the original payload shape', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
