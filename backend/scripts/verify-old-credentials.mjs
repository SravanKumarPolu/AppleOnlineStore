#!/usr/bin/env node
// Prove that a PREVIOUS (exposed) admin credential pair is dead.
//
// "The file changed" is not evidence that the old credential stopped working:
// the only valid proof is presenting the old values to the real app and getting
// a 401. This script boots the real Express app against an in-memory MongoDB
// with the CURRENT configuration and tries, in order:
//
//   1. admin login with the EXPOSED password        -> must be 401
//   2. admin route with a JWT signed by the EXPOSED secret -> must be 401
//   3. admin login with the CURRENT password        -> must be 200 (control)
//   4. admin route with a JWT signed by the CURRENT secret  -> must be 200 (control)
//
// Steps 3–4 keep the test honest: without them a 401 could just mean the route
// is broken. Values are never printed — only status codes.
//
// Usage
//   node scripts/verify-old-credentials.mjs --exposed-blob e8f6c66d
//   node scripts/verify-old-credentials.mjs --exposed-env /path/to/old.env
//
// Exit codes: 0 = old credentials rejected and current pair works
//             1 = an old credential still authenticates
//             2 = setup error (missing input / app did not boot)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { parseEnvFile } from './audit-dangling-blobs.mjs';

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const TOPLEVEL = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: BACKEND, encoding: 'utf8' }).trim();

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
};

const blobRef = flag('--exposed-blob');
const exposedEnv = flag('--exposed-env');
if (!blobRef && !exposedEnv) {
  console.error('❌ Pass --exposed-blob <sha|prefix> or --exposed-env <path>');
  process.exit(2);
}

let exposed;
if (blobRef) {
  const sha = execFileSync('git', ['rev-parse', blobRef], { cwd: TOPLEVEL, encoding: 'utf8' }).trim();
  const text = execFileSync('git', ['cat-file', '-p', sha], { cwd: TOPLEVEL, encoding: 'utf8' });
  exposed = parseEnvFile(text);
  console.log(`Exposed source: git blob ${sha.slice(0, 8)}`);
} else {
  const path = resolve(exposedEnv);
  if (!existsSync(path)) {
    console.error(`❌ No such file: ${path}`);
    process.exit(2);
  }
  exposed = parseEnvFile(readFileSync(path, 'utf8'));
  console.log('Exposed source: explicit env file');
}

dotenv.config({ path: join(BACKEND, '.env') });
const currentPassword = process.env.ADMIN_PASSWORD;
const currentSecret = process.env.JWT_SECRET;
const adminEmail = process.env.ADMIN_EMAIL;

if (!currentPassword || !currentSecret || !adminEmail) {
  console.error('❌ current ADMIN_PASSWORD / JWT_SECRET / ADMIN_EMAIL missing from backend/.env');
  process.exit(2);
}
if (!exposed.get('ADMIN_PASSWORD') || !exposed.get('JWT_SECRET')) {
  console.error('❌ exposed source does not contain ADMIN_PASSWORD and JWT_SECRET');
  process.exit(2);
}

// The app must not reach a real database; NODE_ENV=test also disables the
// sweeper timers that would otherwise keep the process alive.
process.env.NODE_ENV = 'test';

const { startTestDb, stopTestDb } = await import('../__tests__/helpers.mjs');
const { default: app } = await import('../app.js');

const db = await startTestDb();
try {
  const login = (password) =>
    request(app).post('/api/user/admin').send({ email: adminEmail, password });
  const adminRoute = (token) => request(app).get('/api/orders/all').set('token', token);

  const oldPasswordLogin = await login(exposed.get('ADMIN_PASSWORD'));
  const oldPasswordRoute =
    oldPasswordLogin.status === 200
      ? (await adminRoute(oldPasswordLogin.body.token)).status
      : 'n/a';

  const exposedToken = jwt.sign(
    { email: adminEmail, role: 'admin', type: 'admin' },
    exposed.get('JWT_SECRET'),
    { expiresIn: '1h' }
  );
  const exposedTokenRoute = (await adminRoute(exposedToken)).status;

  const freshPasswordLogin = await login(currentPassword);
  const freshPasswordRoute =
    freshPasswordLogin.status === 200
      ? (await adminRoute(freshPasswordLogin.body.token)).status
      : 'n/a';
  const freshToken = jwt.sign(
    { email: adminEmail, role: 'admin', type: 'admin' },
    currentSecret,
    { expiresIn: '1h' }
  );
  const freshTokenRoute = (await adminRoute(freshToken)).status;

  const report = {
    exposed_admin_password_login: oldPasswordLogin.status,
    exposed_admin_password_admin_route: oldPasswordRoute,
    exposed_jwt_secret_token: exposedTokenRoute,
    current_admin_password_login: freshPasswordLogin.status,
    current_admin_password_admin_route: freshPasswordRoute,
    current_jwt_secret_token: freshTokenRoute,
  };
  console.log(JSON.stringify(report, null, 2));

  const oldAccepted =
    oldPasswordLogin.status === 200 ||
    exposedTokenRoute === 200 ||
    oldPasswordRoute === 200;
  const controlWorks = freshPasswordLogin.status === 200 && freshTokenRoute === 200;

  if (!controlWorks) {
    console.error('❌ Control failed: the CURRENT credentials did not authenticate — result is inconclusive.');
    process.exit(2);
  }
  if (oldAccepted) {
    console.error('❌ An EXPOSED credential still authenticates — rotation incomplete.');
    process.exit(1);
  }
  console.log('✅ Old admin password and old JWT secret are both rejected; current pair works.');
} finally {
  await stopTestDb(db);
}
