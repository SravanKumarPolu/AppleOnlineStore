// Phase 1 work areas 4/5 — REAL startup, readiness, and shutdown integration.
// Spawns `node server.js` as a child process against an in-memory MongoDB:
//   1. asserts readiness flips to 200 only after DB init completes
//   2. asserts SIGTERM produces a graceful, exit-0 shutdown
//   3. asserts a broken DB produces a fail-fast, exit-1 startup
//   4. asserts a canary password never appears in process output
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startTestDb, stopTestDb } from './helpers.mjs';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4571;
const CANARY = 'INTEGRATION-CANARY-PASSWORD';

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb(db);
});

function spawnServer({ mongodbUri, port = PORT }) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      // Passed env wins over .env loaded by dotenv — the real Atlas URI in
      // backend/.env is therefore NOT used by the test child.
      MONGODB_URI: mongodbUri,
      PORT: String(port),
      NODE_ENV: 'test',
      JWT_SECRET: 'integration-test-jwt-secret',
      PAYPAL_CLIENT_ID: 'test-client-id',
      PAYPAL_CLIENT_SECRET: 'test-client-secret',
      PAYPAL_WEBHOOK_ID: 'test-webhook-id',
      PAYPAL_ENV: 'sandbox',
      ADMIN_EMAIL: 'admin@test.local',
      // Secret-bearing canary: process output must never contain it.
      ADMIN_PASSWORD: CANARY,
      SHUTDOWN_TIMEOUT_MS: '8000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => output.push(chunk));
  return { child, getOutput: () => output.join('') };
}

function httpGet(port, requestPath, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: requestPath, agent: false },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`GET ${requestPath} timed out`));
    });
  });
}

async function waitForReady(port, timeoutMs = 25000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await httpGet(port, '/health/ready', { timeoutMs: 1500 });
      if (res.status === 200) return res;
    } catch (error) {
      lastError = error; // not listening yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server never became ready (${lastError?.message})`);
}

function childExit(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not exit in time')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe('server startup, readiness and graceful shutdown (real process)', () => {
  it(
    'reports ready only after DB init, serves requests, and exits 0 on SIGTERM',
    async () => {
      // Base URI without db name and without credentials (the in-memory
      // mongod runs auth-free); server appends /e-commerce like production.
      const baseUri = db.mongod.getUri().replace(/\/$/, '');
      const { child, getOutput } = spawnServer({ mongodbUri: baseUri });

      try {
        // Readiness flips to 200 only after DB init completes.
        const ready = await waitForReady(PORT);
        expect(ready.status).toBe(200);
        expect(JSON.parse(ready.body).checks.database).toBe(true);

        const live = await httpGet(PORT, '/health/live');
        expect(live.status).toBe(200);
        expect(JSON.parse(live.body).status).toBe('live');

        const root = await httpGet(PORT, '/');
        expect(root.status).toBe(200);
      } finally {
        child.kill('SIGTERM');
      }

      const { code, signal } = await childExit(child);
      expect(signal ?? code).not.toBe('SIGKILL'); // graceful, not forced
      expect(code).toBe(0);

      const output = getOutput();
      expect(output).not.toContain(CANARY);
      expect(output).toMatch(/Server started on PORT/);
      expect(output).toMatch(/Graceful shutdown initiated \(SIGTERM\)/);
      expect(output).toMatch(/Graceful shutdown complete/);
    },
    90000
  );

  it(
    'fails fast with exit code 1 when the database is unreachable (and logs no secrets)',
    async () => {
      const { child, getOutput } = spawnServer({
        mongodbUri: `mongodb://bootfail:${CANARY}@127.0.0.1:1`,
      });

      const { code } = await childExit(child, 40000);
      expect(code).toBe(1); // fail-safe startup, not a hang

      const output = getOutput();
      expect(output).not.toContain(CANARY); // redacted even on failure
      expect(output).toMatch(/Startup failed/);
      // The server must never report listening when init failed.
      expect(output).not.toMatch(/Server started on PORT/);
    },
    60000
  );
});
