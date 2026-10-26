// Startup verification (Phase 8 reliability tooling).
//
// Boots the REAL server (server.js) against an IN-MEMORY MongoDB with a
// BARE HOST URI — exercising the exact production startup path:
//   config validation -> connectDB (db name resolution + ping) ->
//   cloudinary config -> socket init -> listen -> /health/ready 200
//
// Verifies:
//   1. the server reports ready (HTTP 200 on /health/ready)
//   2. the historical default database "e-commerce" was selected
//   3. no credential-shaped strings appear in the startup log
//   4. SIGTERM triggers a graceful shutdown (exit 0)
//
// Usage: node scripts/verify-startup.mjs   (from backend/)
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = process.env.VERIFY_PORT || '3999';
const MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.14';

const mongod = await MongoMemoryServer.create({ binary: { version: MONGOMS_VERSION } });
const uri = mongod.getUri().replace(/\/$/, ''); // bare host URI (no db component)

const child = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT,
    MONGODB_URI: uri, // bare host -> resolver must apply the default database
    JWT_SECRET: 'verify-jwt-secret-for-boot-check-only',
    PAYPAL_ENV: 'sandbox',
    PAYPAL_CLIENT_ID: 'verify-client-id',
    PAYPAL_CLIENT_SECRET: 'verify-client-secret',
    PAYPAL_WEBHOOK_ID: 'verify-webhook-id',
    ADMIN_EMAIL: 'verify@example.com',
    ADMIN_PASSWORD: 'verify-password-only',
    CLOUDINARY_NAME: 'verify-cloud',
    CLOUDINARY_API_KEY: 'verify-key',
    CLOUDINARY_SECRET_KEY: 'verify-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let ready = false;
for (let i = 0; i < 120; i++) {
  try {
    const res = await fetch(`http://localhost:${PORT}/health/ready`);
    if (res.status === 200) {
      ready = true;
      break;
    }
  } catch {
    // not listening yet
  }
  await new Promise((r) => setTimeout(r, 500));
}

const live = await fetch(`http://localhost:${PORT}/health/live`)
  .then((r) => r.json())
  .catch(() => null);

// The default database must have been created on the in-memory server.
await mongoose.connect(`${uri}/e-commerce`);
const dbs = await mongoose.connection.db.admin().listDatabases();
await mongoose.disconnect();

const exitCode = await new Promise((resolve) => {
  child.on('exit', (code) => resolve(code));
  child.kill('SIGTERM');
  setTimeout(() => resolve('timeout'), 10000);
});

const dbSelected = out.includes('MongoDB Connected: e-commerce');
const gracefulExit = exitCode === 0;
const noCredLeak = !/mongodb(\+srv)?:\/\/[^*]+:[^*]+@/.test(out.replace(/mongodb(\+srv)?:\/\/\*\*:\*\*@/g, ''));

console.log('READY:', ready);
console.log('LIVE:', JSON.stringify(live));
console.log('DATABASES ON SERVER:', dbs.databases.map((d) => d.name).join(', '));
console.log('DEFAULT DB SELECTED (e-commerce):', dbSelected);
console.log('GRACEFUL SIGTERM EXIT (code 0):', gracefulExit, `(exit=${exitCode})`);
console.log('NO CREDENTIALS IN STARTUP LOG:', noCredLeak);
console.log('--- STARTUP LOG ---');
console.log(out.split('\n').filter((l) => l.trim() && !l.includes('Email service')).join('\n'));

await mongod.stop();
const pass = ready && dbSelected && gracefulExit && noCredLeak;
console.log(pass ? '✅ STARTUP VERIFICATION PASSED' : '❌ STARTUP VERIFICATION FAILED');
process.exit(pass ? 0 : 1);
