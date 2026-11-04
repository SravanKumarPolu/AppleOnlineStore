// Multi-instance Socket.IO tests.
//
// Two REAL SocketService instances, two REAL HTTP servers, TWO REAL ioredis
// client pairs and the REAL @socket.io/redis-adapter, connected through an
// in-process Redis protocol server (__tests__/miniRedis.mjs). This is a
// genuine multi-instance fan-out test: an event emitted by instance A is
// delivered to a client connected to instance B only through the adapter.
//
// It is NOT a multi-Pod test: both instances live in this Node process. True
// cross-cluster validation still requires two backend pods sharing a real
// Redis (documented in docs/06 §9).
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from 'node:http';
import { io as ioClient } from 'socket.io-client';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import app from '../app.js';
import socketService, { SocketService } from '../services/socketService.js';
import { MiniRedisServer } from './miniRedis.mjs';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  createTestOrderDoc,
  makeUserToken,
  makeAdminToken,
} from './helpers.mjs';

const ENV_KEYS = [
  'REDIS_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'REDIS_TLS',
  'SOCKETIO_REDIS_REQUIRED',
  'SOCKETIO_REDIS_CONNECT_TIMEOUT_MS',
  'SOCKETIO_REDIS_KEY',
  'SOCKETIO_TRANSPORTS',
];

const savedEnv = {};
let db;
let user;
let userToken;
let adminToken;
let redisServer = null;
const services = [];
const httpServers = [];
const sockets = [];

function setRedisEnv(overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
}

function clearRedisEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function startRedis() {
  redisServer = new MiniRedisServer();
  await redisServer.start();
  setRedisEnv({ REDIS_URL: redisServer.url() });
  return redisServer;
}

async function stopRedis({ keepEnv = false } = {}) {
  if (redisServer) {
    const server = redisServer;
    redisServer = null;
    await server.stop();
  }
  if (!keepEnv) clearRedisEnv();
}

async function createInstance() {
  const service = new SocketService();
  const httpServer = createServer();
  await service.initialize(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  services.push(service);
  httpServers.push(httpServer);
  return { service, httpServer, port: httpServer.address().port };
}

function connect(port, token, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token },
      ...options,
    });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 15000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForEvent(socket, event, predicate = () => true, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeout);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function waitFor(fn, { timeout = 8000, interval = 50, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

const orderId = '507f1f77bcf86cd799439011';

function realtimeOrder(overrides = {}) {
  return {
    _id: orderId,
    userId: String(user._id),
    paymentStatus: 'pending',
    orderStatus: 'Order Placed',
    refundStatus: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
  adminToken = makeAdminToken('admin@redis.test');
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.disconnect();
    } catch {
      // already closed
    }
  }
  for (const service of services.splice(0)) {
    await service.close().catch(() => {});
  }
  // The health spec initializes the app singleton; close it too or its Redis
  // clients and revalidation timer outlive the test run.
  if (socketService.io) {
    await socketService.close().catch(() => {});
  }
  for (const server of httpServers.splice(0)) {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  await stopRedis();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('Socket.IO without Redis (single-replica behavior preserved)', () => {
  it('reports memory mode and does not create Redis clients', async () => {
    const { service } = await createInstance();
    expect(service.getRealtimeMode()).toBe('memory');
    expect(service.redisPub).toBeNull();
    expect(service.redisSub).toBeNull();
    expect(service.getRealtimeStatus().redis).toEqual({
      enabled: false,
      required: false,
      target: null,
    });
  });

  it('still refuses an unauthenticated socket', async () => {
    const { port } = await createInstance();
    await expect(connect(port, undefined, { auth: {} })).rejects.toThrow(/No token provided/i);
  });
});

describe('Redis adapter lifecycle', () => {
  it('attaches only after both clients are ready and reports redis mode', async () => {
    await startRedis();
    const { service } = await createInstance();

    expect(service.getRealtimeMode()).toBe('redis');
    expect(service.redisPub.status).toBe('ready');
    expect(service.redisSub.status).toBe('ready');
    expect(service.getRealtimeStatus().redis).toMatchObject({
      enabled: true,
      required: false,
    });
  });

  it('does not create a second Redis client pair on repeated initialization', async () => {
    await startRedis();
    const service = new SocketService();
    const httpServer = createServer();

    const firstIo = await service.initialize(httpServer);
    const pub = service.redisPub;
    const sub = service.redisSub;

    const secondIo = await service.initialize(httpServer);
    expect(secondIo).toBe(firstIo);
    expect(service.redisPub).toBe(pub);
    expect(service.redisSub).toBe(sub);

    services.push(service);
    httpServers.push(httpServer);
  });

  it('honors SOCKETIO_TRANSPORTS for websocket-only deployments', async () => {
    setRedisEnv({ SOCKETIO_TRANSPORTS: 'websocket' });
    const { service } = await createInstance();
    expect(service.io.opts.transports).toEqual(['websocket']);
  });

  it('quit()s both Redis clients on close and resets the mode', async () => {
    await startRedis();
    const { service } = await createInstance();
    const pub = service.redisPub;
    const sub = service.redisSub;

    await service.close();

    expect(service.getRealtimeMode()).toBe('uninitialized');
    expect(service.redisPub).toBeNull();
    expect(service.redisSub).toBeNull();
    await waitFor(() => pub.status !== 'ready' && sub.status !== 'ready', {
      label: 'client shutdown',
      timeout: 3000,
    });
  });
});

describe('Redis adapter failure handling', () => {
  it('refuses to initialize when Redis is required but unreachable', async () => {
    setRedisEnv({
      REDIS_URL: 'redis://127.0.0.1:1',
      SOCKETIO_REDIS_REQUIRED: 'true',
      SOCKETIO_REDIS_CONNECT_TIMEOUT_MS: '400',
    });

    const service = new SocketService();
    const httpServer = createServer();

    await expect(service.initialize(httpServer)).rejects.toThrow(
      /Socket.IO Redis adapter is required but unavailable/
    );

    // A failed required init must not leave a usable server behind.
    expect(service.io).toBeNull();
    expect(service.getRealtimeMode()).toBe('uninitialized');
    expect(service.redisPub).toBeNull();
  });

  it('falls back to in-process delivery (and says so) when Redis is optional', async () => {
    setRedisEnv({
      REDIS_URL: 'redis://127.0.0.1:1',
      SOCKETIO_REDIS_REQUIRED: 'false',
      SOCKETIO_REDIS_CONNECT_TIMEOUT_MS: '400',
    });

    const { service } = await createInstance();

    expect(service.getRealtimeMode()).toBe('memory');
    expect(service.redisPub).toBeNull();
    expect(service.getRealtimeStatus().redis.enabled).toBe(true);
  });

  it('treats an invalid REDIS_URL as a required-init failure in production mode', async () => {
    setRedisEnv({ REDIS_URL: 'http://not-redis:6379', SOCKETIO_REDIS_REQUIRED: 'true' });
    const service = new SocketService();
    const httpServer = createServer();

    await expect(service.initialize(httpServer)).rejects.toThrow(/not a valid redis/);
    expect(service.io).toBeNull();
    expect(service.realtimeMode).toBe('uninitialized');
  });

  it('reports degraded when Redis drops and recovers when it returns', async () => {
    const server = await startRedis();
    const { service } = await createInstance();
    expect(service.getRealtimeMode()).toBe('redis');

    const port = server.port;
    await server.stop();
    redisServer = null;

    await waitFor(() => service.getRealtimeMode() === 'degraded', {
      timeout: 10000,
      label: 'degraded mode',
    });

    const revived = new MiniRedisServer();
    await revived.start(port);
    redisServer = revived;

    await waitFor(() => service.getRealtimeMode() === 'redis', {
      timeout: 15000,
      label: 'redis recovery',
    });
  }, 30000);

  it('keeps delivering to local sockets while Redis is down (no crash)', async () => {
    const server = await startRedis();
    const { service, port } = await createInstance();

    const shopper = await connect(port, userToken);
    await waitFor(() => service.getConnectedUsersCount() >= 1, { label: 'socket registration' });

    await server.stop();
    redisServer = null;
    await waitFor(() => service.getRealtimeMode() === 'degraded', {
      timeout: 10000,
      label: 'degraded mode',
    });

    const event = waitForEvent(shopper, 'order_updated');
    service.sendOrderStatusUpdate(realtimeOrder({ orderStatus: 'Packing' }));
    const delivered = await event;
    expect(delivered.orderStatus).toBe('Packing');
  }, 30000);
});

describe('Cross-instance broadcasting (real adapter, two instances)', () => {
  it('delivers new_order from instance A to an admin connected to instance B', async () => {
    await startRedis();
    const a = await createInstance();
    const b = await createInstance();

    const admin = await connect(b.port, adminToken);
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'admin registration' });

    const event = waitForEvent(admin, 'new_order');
    a.service.sendNewOrderToAdmin(realtimeOrder({ type: 'order_created' }));

    const payload = await event;
    expect(payload._id).toBe(orderId);
    expect(payload.type).toBe('order_created');
  });

  it('delivers order_updated to a shopper connected to the other instance', async () => {
    await startRedis();
    const a = await createInstance();
    const b = await createInstance();

    const shopper = await connect(b.port, userToken);
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'shopper registration' });

    const event = waitForEvent(shopper, 'order_updated');
    a.service.sendOrderStatusUpdate(realtimeOrder({ orderStatus: 'Shipped' }));

    const payload = await event;
    expect(payload.orderStatus).toBe('Shipped');
  });

  it('keeps cross-instance delivery after a client reconnect', async () => {
    await startRedis();
    const a = await createInstance();
    const b = await createInstance();

    const shopper = await connect(b.port, userToken, {
      reconnection: true,
      reconnectionDelay: 100,
      reconnectionDelayMax: 500,
    });
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'shopper registration' });

    // Drop the transport; socket.io-client re-handshakes on its own.
    const reconnected = waitForEvent(shopper, 'connect');
    shopper.io.engine.close();
    await reconnected;
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, {
      label: 're-registration',
    });

    const event = waitForEvent(shopper, 'order_updated');
    a.service.sendOrderStatusUpdate(realtimeOrder({ orderStatus: 'Delivered' }));
    const payload = await event;
    expect(payload.orderStatus).toBe('Delivered');
  }, 30000);

  it('delivers exactly ONE event to a socket in both the user and order rooms', async () => {
    await startRedis();
    const a = await createInstance();
    const b = await createInstance();

    const order = await createTestOrderDoc(user._id, { orderStatus: 'Packing' });
    const shopper = await connect(b.port, userToken);
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'shopper registration' });

    const ack = await new Promise((resolve) =>
      shopper.emit('join_order_room', String(order._id), resolve)
    );
    expect(ack).toMatchObject({ ok: true });

    let count = 0;
    shopper.on('order_updated', () => {
      count += 1;
    });

    a.service.sendOrderStatusUpdate(order.toObject());
    await waitFor(() => count >= 1, { label: 'first delivery' });
    // Give a duplicate a full event loop + network flush to appear.
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(count).toBe(1);
  });

  it('revokes a session on every instance (logout on pod A closes pod B sockets)', async () => {
    await startRedis();
    const a = await createInstance();
    const b = await createInstance();

    const shopper = await connect(b.port, userToken);
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'shopper registration' });

    const revoked = waitForEvent(shopper, 'session_revoked');
    a.service.revokeUserSessions(user._id);

    const payload = await revoked;
    expect(payload.reason).toBeTruthy();
    await waitFor(() => b.service.getConnectedUsersCount() === 0, { label: 'remote disconnect' });
  });

  it('revokes by token id across instances', async () => {
    await startRedis();
    const a = await createInstance();
    const b = await createInstance();

    const shopper = await connect(b.port, userToken);
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'shopper registration' });

    const tokenId = jwt.decode(userToken).jti;
    const revoked = waitForEvent(shopper, 'session_revoked');
    a.service.revokeToken(tokenId, 'revoked');

    await expect(revoked).resolves.toMatchObject({ reason: 'revoked' });
  });

  it('rejects a foreign order-room join on the instance the socket is connected to', async () => {
    await startRedis();
    const b = await createInstance();
    const intruderToken = makeUserToken((await createTestUserDoc('user'))._id);
    const intruder = await connect(b.port, intruderToken);
    await waitFor(() => b.service.getConnectedUsersCount() >= 1, { label: 'intruder registration' });

    const order = await createTestOrderDoc(user._id);
    const ack = await new Promise((resolve) =>
      intruder.emit('join_order_room', String(order._id), resolve)
    );
    expect(ack).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('Health reporting', () => {
  it('exposes realtime=memory when the adapter is off', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.realtime).toBe('uninitialized');
  });

  it('reports realtime=redis on /health/ready and /api/socket/status', async () => {
    await startRedis();
    const httpServer = createServer(app);
    await socketService.initialize(httpServer);
    httpServers.push(httpServer);

    const ready = await request(app).get('/health/ready');
    expect(ready.body.checks.realtime).toBe('redis');

    const status = await request(app).get('/api/socket/status');
    expect(status.body.realtime).toMatchObject({
      mode: 'redis',
      redisEnabled: true,
    });
    expect(JSON.stringify(status.body)).not.toMatch(/redis:\/\//);
  });
});
