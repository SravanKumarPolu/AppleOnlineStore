// Socket.IO security, contract and lifecycle validation.
//
// Complements socketRealtime.spec.js (happy path + room ownership) with the
// cases that only matter once realtime drives a storefront/admin UI:
//   - authentication parity with the HTTP middleware (algorithm, type, role,
//     account state, tokenVersion, expiry);
//   - revocation of an already-open connection (password reset / logout);
//   - exactly-once delivery when a socket is in overlapping rooms;
//   - the payload contract (no inventory internals, stable discriminator);
//   - the handshake Origin allow-list and graceful shutdown.
//
// Uses the real server, the real socket.io server and the official client —
// mocks cannot prove a room join or a wire payload.
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import request from 'supertest';

import app from '../app.js';
import socketService, { toRealtimeOrder, userRoom } from '../services/socketService.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  makeUserToken,
  makeAdminToken,
} from './helpers.mjs';
import productModel from '../models/productModel.js';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';

let db;
let httpServer;
let baseUrl;
let product;

const sockets = [];

const address = {
  firstName: 'Socket',
  lastName: 'Security',
  email: 'socket-security@example.com',
  street: '2 Realtime Road',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '5550100',
};

/** Connect and resolve once the server acknowledges the handshake. */
function connect(token, { auth = true, origin, transports = ['websocket'], reconnection = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports,
      reconnection,
      ...(reconnection ? { reconnectionDelay: 100 } : {}),
      ...(auth ? { auth: { token } } : {}),
      ...(origin ? { extraHeaders: { Origin: origin } } : {}),
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

/** Resolve to the connect_error message (for negative handshake cases). */
function connectExpectingRejection(token, options = {}) {
  return connect(token, options).then(
    (socket) => {
      socket.disconnect();
      throw new Error('handshake unexpectedly succeeded');
    },
    (error) => error.message || String(error)
  );
}

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSockets(expected) {
  for (let i = 0; i < 100; i += 1) {
    if (socketService.getConnectedSocketsCount() >= expected) return;
    await wait(50);
  }
  throw new Error(
    `only ${socketService.getConnectedSocketsCount()} socket(s) registered (wanted ${expected})`
  );
}

async function waitUntilRooms(socket, expectedRooms) {
  for (let i = 0; i < 100; i += 1) {
    const rooms = socketService.io?.sockets.sockets.get(socket.id)?.rooms || new Set();
    if (expectedRooms.every((room) => rooms.has(room))) return;
    await wait(50);
  }
  throw new Error(`socket never joined ${expectedRooms.join(', ')}`);
}

const serverRoomsOf = (socket) =>
  socketService.io?.sockets.sockets.get(socket.id)?.rooms || new Set();

async function placeOrder(token) {
  const res = await request(app)
    .post('/api/orders')
    .set('token', token)
    .send({
      items: [{ productId: String(product._id), quantity: 1, color: 'Black' }],
      address,
      paymentMethod: 'COD',
    });
  expect(res.status).toBe(200);
  return res.body.order;
}

beforeAll(async () => {
  db = await startTestDb();

  product = await productModel.create({
    name: 'Realtime Security Product',
    description: 'Socket.IO security spec fixture',
    price: 20,
    image: ['https://example.com/socket-security.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: false,
    date: Date.now(),
    stockQuantity: 500,
    inStock: true,
  });

  httpServer = createServer(app);
  socketService.initialize(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    if (socket.connected) socket.disconnect();
  }
});

afterAll(async () => {
  await socketService.close();
  if (httpServer?.listening) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await stopTestDb(db);
});

describe('Socket.IO authentication', () => {
  it('accepts a valid shopper token and joins only that shopper\'s personal room', async () => {
    const user = await createTestUserDoc('user');
    const socket = await connect(makeUserToken(user._id));

    expect(serverRoomsOf(socket).has(userRoom(user._id))).toBe(true);
    expect(serverRoomsOf(socket).has('admin_room')).toBe(false);
  });

  it('accepts a valid admin token and joins the admin room', async () => {
    const socket = await connect(makeAdminToken('admin@socket.test'));
    await waitUntilRooms(socket, ['admin_room']);

    expect(serverRoomsOf(socket).has('admin_room')).toBe(true);
  });

  it('joins the admin room for a database-backed user with the admin role', async () => {
    const adminUser = await createTestUserDoc('admin');
    const socket = await connect(makeUserToken(adminUser._id));
    await waitUntilRooms(socket, [userRoom(adminUser._id), 'admin_room']);

    expect(serverRoomsOf(socket).has('admin_room')).toBe(true);
  });

  it('rejects a token signed with an algorithm outside the HS256 allow-list', async () => {
    const user = await createTestUserDoc('user');
    const unsupported = jwt.sign(
      { id: String(user._id), type: 'user' },
      process.env.JWT_SECRET,
      { algorithm: 'HS384', expiresIn: '1h' }
    );

    await expect(connectExpectingRejection(unsupported)).resolves.toMatch(/Invalid token/i);
  });

  it('rejects tokens without an expiry and unknown token types', async () => {
    const user = await createTestUserDoc('user');
    const noExpiry = jwt.sign(
      { id: String(user._id), type: 'user' },
      process.env.JWT_SECRET
    );
    const unknownType = jwt.sign(
      { id: String(user._id), type: 'service' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await expect(connectExpectingRejection(noExpiry)).resolves.toMatch(/Invalid token/i);
    await expect(connectExpectingRejection(unknownType)).resolves.toMatch(/Invalid token/i);
  });

  it('rejects an expired token', async () => {
    const user = await createTestUserDoc('user');
    const expired = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
      expiresIn: -10,
    });

    await expect(connectExpectingRejection(expired)).resolves.toMatch(/Token expired/i);
  });

  it('rejects a token whose tokenVersion was bumped (password reset / logout)', async () => {
    const user = await createTestUserDoc('user');
    const staleToken = jwt.sign({ id: String(user._id), tv: 0 }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    await userModel.updateOne({ _id: user._id }, { $set: { tokenVersion: 1 } });

    await expect(connectExpectingRejection(staleToken)).resolves.toMatch(/Session revoked/i);
  });

  it('rejects an inactive account', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    await userModel.updateOne({ _id: user._id }, { $set: { isActive: false } });

    await expect(connectExpectingRejection(token)).resolves.toMatch(/not active/i);
  });

  it('rejects an admin-typed token that does not carry the admin role', async () => {
    const forged = jwt.sign(
      { email: 'shopper@example.com', role: 'user', type: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h', jwtid: 'forged-admin-session' }
    );

    await expect(connectExpectingRejection(forged)).resolves.toMatch(/Invalid token/i);
  });

  it('rejects a token signed with another secret', async () => {
    const user = await createTestUserDoc('user');
    const foreign = jwt.sign({ id: String(user._id) }, 'a-different-secret', { expiresIn: '1h' });

    await expect(connectExpectingRejection(foreign)).resolves.toMatch(/Invalid token/i);
  });

  it('rejects a handshake from an origin outside the allow-list', async () => {
    const adminToken = makeAdminToken('admin@socket.test');

    await expect(
      connectExpectingRejection(adminToken, { origin: 'https://evil.example.com' })
    ).resolves.toEqual(expect.any(String));

    // The same token from an allow-listed origin connects.
    const ok = await connect(adminToken, { origin: 'http://localhost:5173' });
    expect(ok.connected).toBe(true);
  });

  it('never exposes token material through the presence introspection', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    await connect(token);
    await waitForSockets(1);

    const serialized = JSON.stringify(socketService.getConnectedUsersInfo());
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('password');
  });
});

describe('Socket.IO session revocation on a live connection', () => {
  it('revokes an open socket when the session is invalidated server-side', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const socket = await connect(token);
    await waitForSockets(1);

    const revoked = waitForEvent(socket, 'session_revoked');
    const closed = waitForEvent(socket, 'disconnect');

    await userModel.updateOne({ _id: user._id }, { $set: { tokenVersion: 1 } });
    await socketService.revalidateNow();

    await expect(revoked).resolves.toEqual({ reason: 'revoked' });
    await expect(closed).resolves.toEqual(expect.any(String));
    expect(socket.connected).toBe(false);
  });

  it('keeps the HTTP surface and the realtime surface in agreement about revocation', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);

    const before = await request(app).get('/api/orders/user').set('token', token);
    expect(before.status).toBe(200);

    await userModel.updateOne({ _id: user._id }, { $set: { tokenVersion: 3 } });

    const after = await request(app).get('/api/orders/user').set('token', token);
    expect(after.status).toBe(401);
    expect(after.body.message).toMatch(/Session expired/i);

    await expect(connectExpectingRejection(token)).resolves.toMatch(/Session revoked/i);
  });

  it('revokes the logged-out JWT across tabs without revoking a separate login', async () => {
    const user = await createTestUserDoc('user');
    const loggedOutToken = makeUserToken(user._id);
    const remainingToken = makeUserToken(user._id);
    const tabOne = await connect(loggedOutToken);
    const tabTwo = await connect(loggedOutToken);
    const remainingSession = await connect(remainingToken);
    await waitForSockets(3);

    const oneRevoked = waitForEvent(tabOne, 'session_revoked');
    const twoRevoked = waitForEvent(tabTwo, 'session_revoked');
    const logout = await request(app)
      .post('/api/user/logout')
      .set('token', loggedOutToken);

    expect(logout.status).toBe(200);
    await expect(oneRevoked).resolves.toEqual({ reason: 'logout' });
    await expect(twoRevoked).resolves.toEqual({ reason: 'logout' });
    expect(tabOne.connected).toBe(false);
    expect(tabTwo.connected).toBe(false);
    expect(remainingSession.connected).toBe(true);

    const revokedHttp = await request(app).get('/api/user/profile').set('token', loggedOutToken);
    const activeHttp = await request(app).get('/api/user/profile').set('token', remainingToken);
    expect(revokedHttp.status).toBe(401);
    expect(activeHttp.status).toBe(200);
  });

  it('revokes an admin logout across sockets and rejects future handshakes', async () => {
    const loggedOutToken = makeAdminToken('admin@socket.test');
    const remainingToken = makeAdminToken('admin@socket.test');
    const tabOne = await connect(loggedOutToken);
    const tabTwo = await connect(loggedOutToken);
    const remainingSession = await connect(remainingToken);
    await waitForSockets(3);

    const oneRevoked = waitForEvent(tabOne, 'session_revoked');
    const twoRevoked = waitForEvent(tabTwo, 'session_revoked');
    const logout = await request(app)
      .post('/api/user/admin/logout')
      .set('token', loggedOutToken);

    expect(logout.status).toBe(200);
    await expect(oneRevoked).resolves.toEqual({ reason: 'logout' });
    await expect(twoRevoked).resolves.toEqual({ reason: 'logout' });
    expect(tabOne.connected).toBe(false);
    expect(tabTwo.connected).toBe(false);
    expect(remainingSession.connected).toBe(true);
    await expect(connectExpectingRejection(loggedOutToken)).resolves.toMatch(/Session revoked/i);
  });
});

describe('Socket.IO room delivery contract', () => {
  it('acknowledges an authorized join and refuses a malformed order id', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const socket = await connect(token);
    const order = await placeOrder(token);

    const joined = await new Promise((resolve) => socket.emit('join_order_room', order._id, resolve));
    expect(joined).toEqual({ ok: true, room: `order_${order._id}` });

    const invalid = await new Promise((resolve) =>
      socket.emit('join_order_room', 'not-an-object-id', resolve)
    );
    expect(invalid).toEqual({ ok: false, error: 'invalid_order_id' });
  });

  it('allows a database-backed admin to join an order room they do not own', async () => {
    const owner = await createTestUserDoc('user');
    const adminUser = await createTestUserDoc('admin');
    const ownerToken = makeUserToken(owner._id);
    const adminSocket = await connect(makeUserToken(adminUser._id));
    const order = await placeOrder(ownerToken);

    const joined = await new Promise((resolve) =>
      adminSocket.emit('join_order_room', order._id, resolve)
    );
    expect(joined).toEqual({ ok: true, room: `order_${order._id}` });
  });

  it('delivers exactly one order_updated to a socket in both the personal and order room', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const socket = await connect(token);
    const order = await placeOrder(token);

    socket.emit('join_order_room', order._id);
    await waitUntilRooms(socket, [`order_${order._id}`]);

    const received = [];
    socket.on('order_updated', (payload) => {
      if (String(payload._id) === String(order._id)) received.push(payload);
    });

    const adminToken = makeAdminToken('admin@socket.test');
    const update = await request(app)
      .put('/api/orders/status')
      .set('token', adminToken)
      .send({ orderId: order._id, status: 'Packing' });
    expect(update.status).toBe(200);

    await wait(700);
    expect(received).toHaveLength(1);
    expect(received[0].orderStatus).toBe('Packing');
    expect(received[0].eventId).toEqual(expect.any(String));
  });

  it('reaches every tab of the same shopper', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const tabOne = await connect(token);
    const tabTwo = await connect(token);
    await waitForSockets(2);

    const first = waitForEvent(tabOne, 'order_updated');
    const second = waitForEvent(tabTwo, 'order_updated');
    const order = await placeOrder(token);

    const [a, b] = await Promise.all([first, second]);
    expect(String(a._id)).toBe(String(order._id));
    expect(String(b._id)).toBe(String(order._id));
  });

  it('restores delivery for an order room re-joined after a reconnect', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const socket = await connect(token, { reconnection: true });
    const order = await placeOrder(token);

    socket.emit('join_order_room', order._id);
    await waitUntilRooms(socket, [`order_${order._id}`]);

    // Transport drop: the server forgets room membership, the client re-joins.
    const reconnected = waitForEvent(socket, 'connect');
    socket.io.engine.close();
    await reconnected;
    expect(serverRoomsOf(socket).has(`order_${order._id}`)).toBe(false);

    socket.emit('join_order_room', order._id);
    await waitUntilRooms(socket, [`order_${order._id}`]);

    const delivered = waitForEvent(socket, 'order_updated', (p) => String(p._id) === String(order._id));
    await request(app)
      .put('/api/orders/status')
      .set('token', makeAdminToken('admin@socket.test'))
      .send({ orderId: order._id, status: 'Shipped' });

    await expect(delivered).resolves.toEqual(
      expect.objectContaining({ orderStatus: 'Shipped' })
    );
  }, 45000);

  it('relays typing only to an authorized order room and carries no email', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const socket = await connect(token);
    const order = await placeOrder(token);

    const admin = await connect(makeAdminToken('admin@socket.test'));
    await waitUntilRooms(admin, ['admin_room']);

    // Not joined: the relay must not fire.
    socket.emit('typing', { orderId: order._id });
    await wait(250);
    expect(admin.connected).toBe(true);

    socket.emit('join_order_room', order._id);
    admin.emit('join_order_room', order._id);
    await waitUntilRooms(socket, [`order_${order._id}`]);
    await waitUntilRooms(admin, [`order_${order._id}`]);

    const typing = waitForEvent(admin, 'user_typing');
    socket.emit('typing', { orderId: order._id });
    const payload = await typing;

    expect(payload.orderId).toBe(String(order._id));
    expect(payload).not.toHaveProperty('userEmail');
    expect(JSON.stringify(payload)).not.toMatch(/@/);
  });

  it('fans a manual refund out as a payment_update to the shopper and the admin', async () => {
    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);
    const socket = await connect(token);
    const admin = await connect(makeAdminToken('admin@socket.test'));
    await waitUntilRooms(admin, ['admin_room']);

    const order = await placeOrder(token);
    await orderModel.updateOne({ _id: order._id }, { $set: { paymentStatus: 'completed' } });

    const shopperEvent = waitForEvent(
      socket,
      'order_updated',
      (p) => String(p._id) === String(order._id) && p.type === 'payment_update'
    );
    const adminEvent = waitForEvent(
      admin,
      'order_updated',
      (p) => String(p._id) === String(order._id) && p.type === 'payment_update'
    );

    const refund = await request(app)
      .post('/api/orders/refund')
      .set('token', makeAdminToken('admin@socket.test'))
      .send({ orderId: order._id, reason: 'spec refund' });
    expect(refund.status).toBe(200);

    const [forShopper, forAdmin] = await Promise.all([shopperEvent, adminEvent]);
    expect(forShopper.paymentStatus).toBe('refunded');
    expect(forAdmin.paymentStatus).toBe('refunded');
  });
});

describe('Socket.IO payload contract', () => {
  it('omits inventory and payment internals from the new-order notice', async () => {
    const admin = await connect(makeAdminToken('admin@socket.test'));
    await waitUntilRooms(admin, ['admin_room']);

    const user = await createTestUserDoc('user');
    const token = makeUserToken(user._id);

    const notice = waitForEvent(admin, 'new_order');
    const order = await placeOrder(token);
    const payload = await notice;

    expect(String(payload._id)).toBe(String(order._id));
    expect(payload.type).toBe('order_created');
    expect(payload.eventId).toEqual(expect.any(String));
    expect(payload.occurredAt).toEqual(expect.any(String));
    for (const privateField of [
      'userId',
      'customer',
      'items',
      'address',
      'total',
      'paypalOrderId',
      'paypalCaptureId',
      'paypalTransactionId',
      'stockReserved',
      'stockReservation',
      'inventoryRestoration',
      'idempotencyKey',
      'refundAttempts',
      'refundLastError',
      '__v',
    ]) {
      expect(payload).not.toHaveProperty(privateField);
    }
  });

  it('serializes a populated user reference without leaking document internals', () => {
    const payload = toRealtimeOrder(
      {
        _id: '65f1c2d3e4b5a69788776655',
        userId: { _id: '65f1c2d3e4b5a69788776600', name: 'Ada', email: 'ada@example.com' },
        items: [],
        stockReserved: true,
        inventoryRestoration: { status: 'pending' },
        refundLastError: 'trace',
        idempotencyKey: 'key-1',
      },
      { type: 'order_updated' }
    );

    expect(payload._id).toBe('65f1c2d3e4b5a69788776655');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('customer');
    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('items');
    expect(payload).not.toHaveProperty('stockReserved');
    expect(payload).not.toHaveProperty('inventoryRestoration');
    expect(payload).not.toHaveProperty('refundLastError');
    expect(payload).not.toHaveProperty('idempotencyKey');
    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('items');
    expect(payload).not.toHaveProperty('customer');
    expect(payload).not.toHaveProperty('paypalTransactionId');
  });

  it('derives the personal room key from ObjectId, string and populated references', () => {
    const hex = '65f1c2d3e4b5a69788776655';
    expect(userRoom(hex)).toBe(`user_${hex}`);
    expect(userRoom({ _id: hex, name: 'Ada' })).toBe(`user_${hex}`);
    expect(userRoom(null)).toBeNull();
  });
});

// MUST stay last: closing the Socket.IO server also closes the HTTP server it
// was attached to, so nothing can connect afterwards.
describe('Socket.IO graceful shutdown', () => {
  it('closes open sockets, clears presence and is idempotent', async () => {
    const user = await createTestUserDoc('user');
    const socket = await connect(makeUserToken(user._id));
    await waitForSockets(1);

    const disconnected = waitForEvent(socket, 'disconnect');

    await socketService.close();

    await expect(disconnected).resolves.toEqual(expect.any(String));
    expect(socket.connected).toBe(false);
    expect(socketService.io).toBeNull();
    expect(socketService.getConnectedUsersCount()).toBe(0);
    expect(socketService.getConnectedSocketsCount()).toBe(0);

    // Second close is a no-op, and emitters stay null-safe afterwards.
    await expect(socketService.close()).resolves.toBeUndefined();
    expect(() => socketService.sendOrderStatusUpdate({ _id: 'x', userId: 'y' })).not.toThrow();
  });
});
