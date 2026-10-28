// Shared helpers for the backend security/regression suite.
// In-memory MongoDB (mongodb-memory-server is already a devDependency) +
// fixtures that match the real model schemas.
import crypto from 'node:crypto';
import net from 'node:net';
import bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

import userModel from '../models/userModel.js';
import orderModel from '../models/orderModel.js';

// Debian 12/13 hosts can only fetch MongoDB >= 7.0.3 binaries.
const MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.14';

// Pick the mongod port explicitly instead of letting the library choose.
// mongod also opens a legacy HTTP interface on <port + 1000>; letting it pick
// an arbitrary low port produced a real, intermittent suite failure in this
// audit ("Port 8081 already in use" because a container on the host owns
// 8081). The 28000–28999 range keeps both ports clear of common host
// services and of Docker's defaults.
const TEST_DB_PORT_RANGE = { start: 28000, size: 1000 };

const isPortFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });

const pickMongoPort = async () => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const port = TEST_DB_PORT_RANGE.start + crypto.randomInt(0, TEST_DB_PORT_RANGE.size);
    if (await isPortFree(port)) return port;
  }
  return null; // fall back to the library's own allocation
};

export async function startTestDb() {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await pickMongoPort();
    let mongod;
    try {
      mongod = await MongoMemoryServer.create({
        binary: { version: MONGOMS_VERSION },
        ...(port ? { instance: { port } } : {}),
      });
      const uri = mongod.getUri('novacart-test');
      await mongoose.connect(uri);

      // Mirror the production startup contract (config/mongodb.js): every
      // declared index exists before the first request. Mongoose otherwise
      // builds them in the background, which let the idempotency race spec
      // write five orders under one unique key (the unique partial index did
      // not exist yet). Tests must exercise the same guarantees as runtime.
      await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

      return { mongod, uri };
    } catch (error) {
      lastError = error;
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }
      // A failed start must not leave mongod running: an orphaned instance
      // holds its port and keeps the Jest process alive after the run.
      if (mongod) {
        await mongod.stop().catch(() => {});
      }
      const message = String(error?.message || error);
      const retryable = /already in use|EADDRINUSE/i.test(message);
      if (!retryable || attempt === 3) throw error;
    }
  }

  throw lastError;
}

// Tolerate a failed start: specs call this from afterAll, and a teardown must
// never mask the original startup error with "cannot destructure mongod".
export async function stopTestDb(instance) {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (instance?.mongod) {
    await instance.mongod.stop();
  }
}

export function makeAdminToken(email = 'admin@test.local') {
  return jwt.sign({ email, role: 'admin', type: 'admin' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
    jwtid: crypto.randomUUID(),
  });
}

export function makeUserToken(userId) {
  return jwt.sign(
    { id: String(userId), type: 'user' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', jwtid: crypto.randomUUID() }
  );
}

export async function createTestUserDoc(role = 'user') {
  return userModel.create({
    name: 'Test User',
    email: `user-${crypto.randomBytes(6).toString('hex')}@example.com`,
    password: 'TestPassword123!',
    role,
    isActive: true,
    emailVerified: true,
  });
}

// User fixture whose password is a REAL bcrypt hash, mirroring what the
// registration controller stores. createTestUserDoc keeps the fixture
// password as-is (mongoose has no hashing hook — the controllers hash
// before create), which is fine for token-only fixtures but breaks any
// bcrypt.compare-based flow (login, password reset). Use this helper when
// the spec needs to actually authenticate with the fixture password.
export async function createLoginUserDoc(email, password = 'TestPassword123!') {
  const hashedPassword = await bcrypt.hash(password, 12);
  return userModel.create({
    name: 'Login User',
    email: (email || `login-${crypto.randomBytes(6).toString('hex')}@example.com`).toLowerCase(),
    password: hashedPassword,
    role: 'user',
    isActive: true,
  });
}

export async function createTestOrderDoc(userId, overrides = {}) {
  return orderModel.create({
    userId,
    items: [
      {
        productId: 'test-product-id',
        name: 'Test Product',
        image: 'https://example.com/product.png',
        price: 10,
        quantity: 1,
        color: 'Black',
      },
    ],
    address: {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      street: '1 Test Street',
      city: 'Test City',
      state: 'TS',
      zipcode: '12345',
      country: 'Testland',
      phone: '555-123-4567',
    },
    paymentMethod: 'PayPal',
    paymentStatus: 'pending',
    orderStatus: 'Order Placed',
    subtotal: 10,
    shipping: 10,
    total: 20,
    currency: 'USD',
    ...overrides,
  });
}

// Valid PayPal transmission headers for webhook requests (values are dummy
// test strings — the verifier is injected with a stub client in tests).
export const WEBHOOK_HEADERS = {
  'paypal-transmission-id': 'test-transmission-id',
  'paypal-transmission-time': '2026-10-23T00:00:00Z',
  'paypal-transmission-sig': 'test-signature',
  'paypal-cert-url': 'https://example.com/cert',
  'paypal-auth-algo': 'SHA256withRSA',
};

// Realistic PAYMENT.CAPTURE.COMPLETED resource: PayPal always sends the
// captured amount/currency and (for capture webhooks) the related order id in
// supplementary_data. Defaults match createTestOrderDoc (total 20.00 USD).
// `overrides` replaces top-level resource keys (amount, supplementary_data...).
export function webhookEvent(
  id,
  event_type = 'PAYMENT.CAPTURE.COMPLETED',
  resourceId = 'CAP-TEST',
  overrides = {}
) {
  const resource = {
    id: resourceId,
    status: 'COMPLETED',
    amount: { currency_code: 'USD', value: '20.00' },
    supplementary_data: { related_ids: { order_id: 'PAY-TEST-ORDER' } },
    ...overrides,
  };
  return { id, event_type, resource };
}
