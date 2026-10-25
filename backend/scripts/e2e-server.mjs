// E2E stack orchestrator (Playwright webServer) — boots the REAL backend
// against an in-memory MongoDB for browser-driven checkout tests.
//
//   node scripts/e2e-server.mjs
//
// Sequence: start mongod -> seed the catalog directly through the real
// product model (bypasses the Cloudinary-gated admin upload) -> spawn
// `node server.js` with a self-contained env -> wait for /health/ready 200
// -> stay alive until SIGTERM (Playwright kills the webServer at the end of
// the run). No real credentials are involved: PayPal vars are e2e
// placeholders, the DB is ephemeral, and everything lives on localhost.
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import productModel from '../models/productModel.js';

const PORT = process.env.E2E_PORT || '3001';
// config/mongodb.js applies the default database ("e-commerce") when the
// URI has no database component — the in-memory URI passed below is a bare
// host URI, so seeding must target the same resolved database.
const DB_NAME = 'e-commerce';
const readyUrl = `http://localhost:${PORT}/health/ready`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBackend() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(readyUrl);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await wait(500);
  }
  throw new Error(`backend never became ready at ${readyUrl}`);
}

async function seedCatalog(uri) {
  await mongoose.connect(`${uri}/${DB_NAME}`);
  const existing = await productModel.countDocuments();
  if (existing === 0) {
    await productModel.create([
      {
        name: 'iPhone 15 Pro E2E',
        description: 'E2E fixture flagship phone with titanium body.',
        price: 999,
        image: ['https://example.com/e2e-iphone.png'],
        category: 'iPhone',
        subCategory: 'Pro',
        color: ['Black', 'Silver'],
        bestseller: true,
        date: Date.now() + 3000,
        stockQuantity: 10,
        inStock: true,
      },
      {
        name: 'MacBook Air E2E',
        description: 'E2E fixture laptop with all-day battery.',
        price: 1099,
        image: ['https://example.com/e2e-macbook.png'],
        category: 'Mac',
        subCategory: 'Air',
        color: ['Silver'],
        bestseller: true,
        date: Date.now() + 2000,
        stockQuantity: 6,
        inStock: true,
      },
      {
        name: 'AirPods Pro E2E',
        description: 'E2E fixture earbuds with noise cancellation.',
        price: 249,
        image: ['https://example.com/e2e-airpods.png'],
        category: 'AirPods',
        subCategory: 'Pro',
        color: ['White'],
        bestseller: false,
        date: Date.now() + 1000,
        stockQuantity: 15,
        inStock: true,
      },
    ]);
    console.log('[e2e-backend] catalog seeded (3 products)');
  }
  await mongoose.disconnect();
}

const mongod = await MongoMemoryServer.create({
  binary: { version: '7.0.14' }, // matches the cached binary used by jest specs
});
const uri = mongod.getUri().replace(/\/$/, ''); // strip trailing slash + no db name

await seedCatalog(uri);

const child = spawn(process.execPath, ['server.js'], {
  cwd: new URL('.', import.meta.url).pathname.replace('/scripts/', '/'),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT,
    MONGODB_URI: uri,
    JWT_SECRET: 'e2e-run-only-jwt-secret-not-a-real-credential',
    PAYPAL_ENV: 'sandbox',
    PAYPAL_CLIENT_ID: 'e2e-paypal-client-id',
    PAYPAL_CLIENT_SECRET: 'e2e-paypal-client-secret',
    PAYPAL_WEBHOOK_ID: 'e2e-paypal-webhook-id',
    APP_NAME: 'NovaCart',
    FRONTEND_URL: 'http://localhost:5173',
    ADMIN_URL: 'http://localhost:5174',
    ADMIN_EMAIL: 'e2e-admin@example.com',
    ADMIN_PASSWORD: 'e2e-admin-password-1',
    CLOUDINARY_NAME: 'e2e-cloud',
    CLOUDINARY_API_KEY: 'e2e-key',
    CLOUDINARY_SECRET_KEY: 'e2e-secret',
    // Deliberately no SMTP_* — email flows are not under E2E test.
  },
  stdio: 'inherit',
});

let shuttingDown = false;
const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill('SIGTERM');
  await new Promise((resolve) => {
    const forced = setTimeout(resolve, 8000);
    child.on('exit', () => {
      clearTimeout(forced);
      resolve();
    });
  });
  await mongod.stop().catch(() => {});
  process.exit(code);
};

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
child.on('exit', (code) => shutdown(code ?? 0));

await waitForBackend();
console.log(`[e2e-backend] ready at ${readyUrl}`);

// Keep the process alive for the Playwright run.
setInterval(() => {}, 1 << 30);
