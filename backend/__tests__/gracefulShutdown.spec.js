// Phase 1 work area 5 + final gate Task 3 — graceful shutdown.
// Unit level: the shutdown manager's real logic with fake closers.
// HTTP level: the app drain middleware with real supertest requests.
import { describe, it, expect } from '@jest/globals';
import request from 'supertest';

import { createShutdownManager } from '../utils/shutdownManager.js';
import app, { setShuttingDown } from '../app.js';

const SILENT_LOGGER = { log: () => {}, error: () => {} };

function makeFakeServer({ closeBehavior = 'callback' } = {}) {
  const state = { closeCalls: 0 };
  const server = {
    close(callback) {
      state.closeCalls += 1;
      if (closeBehavior === 'callback') callback();
      // 'hang' -> never calls the callback (timeout path)
    },
  };
  return { server, state };
}

describe('createShutdownManager', () => {
  it('closes http, sockets and database in order and completes', async () => {
    const { server, state } = makeFakeServer();
    const order = [];
    let drained = null;

    const manager = createShutdownManager({
      server,
      onDrain: (v) => {
        drained = v;
        order.push('drain');
      },
      closeSockets: async () => order.push('sockets'),
      closeDatabase: async () => order.push('database'),
      timeoutMs: 500,
    });

    const result = await manager.initiateShutdown('SIGTERM');

    expect(result.duplicate).toBe(false);
    expect(result.completed).toBe(true);
    expect(state.closeCalls).toBe(1);
    expect(drained).toBe(true);
    expect(order).toEqual(['drain', 'sockets', 'database']); // drain first, db last
  });

  it('is idempotent — a duplicate signal is ignored with no extra closes', async () => {
    const { server, state } = makeFakeServer();
    let socketsClosed = 0;
    let dbClosed = 0;

    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: async () => {
        socketsClosed += 1;
      },
      closeDatabase: async () => {
        dbClosed += 1;
      },
      timeoutMs: 500,
    });

    await manager.initiateShutdown('SIGTERM');
    const second = await manager.initiateShutdown('SIGINT'); // duplicate signal

    expect(second.duplicate).toBe(true);
    expect(state.closeCalls).toBe(1);
    expect(socketsClosed).toBe(1);
    expect(dbClosed).toBe(1);
    expect(manager.isShuttingDown()).toBe(true);
  });

  it('is bounded — a hanging server.close resolves via the force timeout', async () => {
    const { server } = makeFakeServer({ closeBehavior: 'hang' });
    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: async () => {},
      closeDatabase: async () => {},
      timeoutMs: 50,
    });

    const start = Date.now();
    const result = await manager.initiateShutdown('SIGTERM');
    const elapsed = Date.now() - start;

    expect(result.completed).toBe(true);
    expect(result.httpClose).toBe('timeout');
    expect(elapsed).toBeLessThan(2000); // bounded, not unbounded hang
  });

  it('survives failing close callbacks (errors logged, shutdown completes)', async () => {
    const { server } = makeFakeServer();
    const manager = createShutdownManager({
      server,
      onDrain: () => {
        throw new Error('drain boom');
      },
      closeSockets: async () => {
        throw new Error('sockets boom');
      },
      closeDatabase: async () => {
        throw new Error('db boom');
      },
      timeoutMs: 200,
      logger: { log: () => {}, error: () => {} },
    });

    const result = await manager.initiateShutdown('SIGTERM');
    expect(result.completed).toBe(true);
  });
});

describe('bounded cleanup lifecycle (final gate Task 3)', () => {
  it('bounds the COMPLETE lifecycle when sockets AND database hang', async () => {
    const { server } = makeFakeServer(); // http closes fine
    const t0 = Date.now();
    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: () => new Promise(() => {}),  // never settles
      closeDatabase: () => new Promise(() => {}), // never settles
      timeoutMs: 80,
      logger: SILENT_LOGGER,
    });

    const result = await manager.initiateShutdown('SIGTERM');
    const elapsed = Date.now() - t0;

    // The chain still completes — bounded by the single deadline.
    expect(result.completed).toBe(true);
    expect(result.forced).toBe(true);
    expect(result.timedOutPhases).toEqual(expect.arrayContaining(['sockets', 'database']));
    expect(elapsed).toBeLessThan(2000); // ~timeoutMs, not an unbounded hang
  });

  it('notifies via onForceExit exactly ONCE when cleanup exceeds the budget', async () => {
    const { server } = makeFakeServer();
    const calls = [];
    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: () => new Promise(() => {}), // hangs
      closeDatabase: async () => {},
      timeoutMs: 60,
      logger: SILENT_LOGGER,
      onForceExit: (phases, reason) => calls.push({ phases, reason }),
    });

    const result = await manager.initiateShutdown('SIGINT');

    expect(calls.length).toBe(1); // once — not per phase, not per signal
    expect(calls[0].phases).toContain('sockets');
    expect(calls[0].reason).toBe('SIGINT');
    expect(result.forced).toBe(true);
  });

  it('force-destroys lingering keep-alive sockets when the http phase times out', async () => {
    const { server } = makeFakeServer({ closeBehavior: 'hang' });
    let closeAllCalls = 0;
    server.closeAllConnections = () => {
      closeAllCalls += 1;
    };
    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: async () => {},
      closeDatabase: async () => {},
      timeoutMs: 40,
      logger: SILENT_LOGGER,
    });

    const result = await manager.initiateShutdown('SIGTERM');

    expect(result.httpClose).toBe('timeout');
    expect(result.timedOutPhases).toContain('http');
    expect(closeAllCalls).toBe(1);
  });

  it('does NOT force on a clean shutdown (exit 0 semantics preserved)', async () => {
    const { server } = makeFakeServer();
    const calls = [];
    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: async () => {},
      closeDatabase: async () => {},
      timeoutMs: 500,
      logger: SILENT_LOGGER,
      onForceExit: (phases) => calls.push(phases),
    });

    const result = await manager.initiateShutdown('SIGTERM');

    expect(result.forced).toBe(false);
    expect(result.timedOutPhases).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it('reports later phases as SKIPPED when the http phase exhausts the budget', async () => {
    const { server } = makeFakeServer({ closeBehavior: 'hang' });
    const closed = [];
    const manager = createShutdownManager({
      server,
      onDrain: () => {},
      closeSockets: async () => closed.push('sockets'),
      closeDatabase: async () => closed.push('database'),
      timeoutMs: 60,
      logger: SILENT_LOGGER,
    });

    const result = await manager.initiateShutdown('SIGTERM');

    expect(result.httpClose).toBe('timeout');
    // http consumed the whole budget => sockets/database are skipped-and-
    // reported (never silently ignored, never run past the deadline).
    expect(result.timedOutPhases).toContain('sockets');
    expect(result.timedOutPhases).toContain('database');
    expect(closed).toEqual([]); // skipped, not executed with zero budget
    expect(result.forced).toBe(true);
  });
});

describe('app drain middleware', () => {
  it('rejects new non-health requests with 503 while shutting down', async () => {
    setShuttingDown(true);
    try {
      const res = await request(app).get('/');
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/shutting down/i);
    } finally {
      setShuttingDown(false);
    }
  });

  it('keeps health endpoints available during shutdown (probes still observe)', async () => {
    setShuttingDown(true);
    try {
      const live = await request(app).get('/health/live');
      expect(live.status).toBe(200);

      const legacy = await request(app).get('/health');
      expect(legacy.status).toBe(200);

      // Task 2: readiness specifically reports not-ready while draining.
      const ready = await request(app).get('/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.checks.shuttingDown).toBe(true);
    } finally {
      setShuttingDown(false);
    }
  });

  it('serves requests normally again once the drain flag is cleared', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });
});
