// End-to-end Socket.IO validation (gap: "emitters are covered, the real
// server↔client lifecycle is not").
//
// Unlike gracefulShutdown (which only proves the emitters are null-safe), this
// spec runs the REAL server: an HTTP server with the real app, the real
// socket.io server from services/socketService.js, and the official
// socket.io-client. It asserts that a connected shopper and a connected admin
// actually receive the order events over the wire, that an unauthenticated
// socket is refused, and that a dropped connection recovers (reconnect) and
// keeps delivering events.
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from 'node:http';
import { io as ioClient } from 'socket.io-client';
import request from 'supertest';

import app from '../app.js';
import socketService from '../services/socketService.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  makeUserToken,
  makeAdminToken,
} from './helpers.mjs';
import productModel from '../models/productModel.js';

let db;
let httpServer;
let baseUrl;
let user;
let userToken;
let adminToken;
let product;

const sockets = [];

const address = {
  firstName: 'Socket',
  lastName: 'Shopper',
  email: 'socket@example.com',
  street: '1 Realtime Road',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '5550100',
};

/** Connect and resolve once the server acknowledges the handshake. */
function connect(token, { auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 100,
      ...(auth ? { auth: { token } } : {}),
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

/** Wait for one event matching an optional predicate. */
function waitForEvent(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      20000
    );
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Both sockets must be registered server-side before an order is placed. */
async function waitForRegistration(expected) {
  for (let i = 0; i < 100; i += 1) {
    if (socketService.getConnectedUsersCount() >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`only ${socketService.getConnectedUsersCount()} socket(s) registered`);
}

const placeOrder = () =>
  request(app)
    .post('/api/orders')
    .set('token', userToken)
    .send({
      items: [{ productId: String(product._id), quantity: 1, color: 'Black' }],
      address,
      paymentMethod: 'COD',
    });

beforeAll(async () => {
  db = await startTestDb();

  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
  adminToken = makeAdminToken('admin@test.local');

  product = await productModel.create({
    name: 'Realtime Product',
    description: 'Socket.IO spec fixture',
    price: 15,
    image: ['https://example.com/realtime.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: false,
    date: Date.now(),
    stockQuantity: 50,
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
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await stopTestDb(db);
});

describe('Socket.IO — real server ↔ real client', () => {
  it('delivers the order to the connected shopper and the new-order event to admin', async () => {
    const shopper = await connect(userToken);
    const admin = await connect(adminToken);
    await waitForRegistration(2);

    const userEvent = waitForEvent(shopper, 'order_updated');
    const adminEvent = waitForEvent(admin, 'new_order');

    const res = await placeOrder();
    expect(res.status).toBe(200);
    const orderId = String(res.body.order._id);

    const delivered = await userEvent;
    expect(String(delivered._id)).toBe(orderId);
    expect(delivered.paymentMethod).toBe('COD');
    expect(delivered.items[0].name).toBe('Realtime Product');

    const adminNotice = await adminEvent;
    expect(String(adminNotice._id)).toBe(orderId);
  });

  it('refuses a socket without a token (no anonymous realtime access)', async () => {
    await expect(connect(null, { auth: false })).rejects.toThrow(/No token provided/i);
  });

  it('refuses a socket with an invalid token', async () => {
    await expect(connect('not-a-jwt')).rejects.toThrow(/Invalid token/i);
  });

  it('re-registers after a reconnect and keeps delivering events', async () => {
    const shopper = await connect(userToken);
    await waitForRegistration(1);

    // Drop the transport and let socket.io-client reconnect on its own.
    const reconnected = waitForEvent(shopper, 'connect');
    shopper.io.engine.close();
    await reconnected;
    await waitForRegistration(1);

    const nextEvent = waitForEvent(shopper, 'order_updated');
    const res = await placeOrder();
    expect(res.status).toBe(200);

    const delivered = await nextEvent;
    expect(String(delivered._id)).toBe(String(res.body.order._id));
  }, 45000);
});
