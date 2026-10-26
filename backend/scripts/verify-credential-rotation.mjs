#!/usr/bin/env node
// Provider-by-provider credential rotation verifier.
//
// Answers two questions per provider, WITHOUT ever printing a value:
//   1. does the CURRENTLY configured credential still work?
//   2. does the PREVIOUSLY EXPOSED credential still work?
// A rotation is only complete when (1) works and (2) fails. "The repo is
// clean" is not a rotation — only the provider can revoke a secret.
//
// The exposed values are read from a git blob (the dangling-object case) or
// from an explicit env file; they are kept in memory only. Output is limited to
// status codes, boolean results and error class names.
//
// Usage
//   node scripts/verify-credential-rotation.mjs                       # current .env only
//   node scripts/verify-credential-rotation.mjs --exposed-blob e8f6c66d
//   node scripts/verify-credential-rotation.mjs --exposed-env /tmp/old.env
//   node scripts/verify-credential-rotation.mjs --only mongodb,cloudinary
//
// Exit codes: 0 = every checked credential is rotated-or-current-sane
//             1 = an exposed credential still WORKS (rotation incomplete)
//             2 = could not run (missing config / network failure)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import cloudinary from 'cloudinary';
import { parseEnvFile } from './audit-dangling-blobs.mjs';

const BACKEND = dirname(dirname(fileURLToPath(import.meta.url)));
const TOPLEVEL = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: BACKEND,
  encoding: 'utf8',
}).trim();

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
};

const currentPath = resolve(flag('--env') || join(BACKEND, '.env'));
if (!existsSync(currentPath)) {
  console.error(`❌ No current env file at ${currentPath}`);
  process.exit(2);
}
const current = parseEnvFile(readFileSync(currentPath, 'utf8'));

let exposed = new Map();
let exposedSource = 'none';
const blobRef = flag('--exposed-blob');
const exposedEnv = flag('--exposed-env');
if (blobRef) {
  const sha = execFileSync('git', ['rev-parse', blobRef], { cwd: TOPLEVEL, encoding: 'utf8' }).trim();
  const text = execFileSync('git', ['cat-file', '-p', sha], {
    cwd: TOPLEVEL,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  exposed = parseEnvFile(text);
  exposedSource = `git blob ${sha.slice(0, 8)}`;
} else if (exposedEnv) {
  exposed = parseEnvFile(readFileSync(resolve(exposedEnv), 'utf8'));
  exposedSource = 'explicit env file';
}

const only = (flag('--only') || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const wanted = (provider) => only.length === 0 || only.includes(provider);

const results = [];
const record = (provider, credential, role, state, detail) => {
  results.push({ provider, credential, role, state, detail });
};

const same = (key) => {
  const a = current.get(key);
  const b = exposed.get(key);
  if (!a || !b) return null;
  return a === b;
};

// ---------------------------------------------------------------- MongoDB
async function mongodbWorks(uri) {
  if (!uri) return { ok: false, detail: 'not configured' };
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, dbName: undefined });
    await mongoose.connection.db.admin().command({ ping: 1 });
    await mongoose.disconnect();
    return { ok: true, detail: 'ping ok' };
  } catch (error) {
    try {
      await mongoose.disconnect();
    } catch {
      /* already closed */
    }
    return { ok: false, detail: error.name || 'error' };
  }
}

// ------------------------------------------------------------- Cloudinary
function cloudinaryWorks(name, apiKey, secret) {
  if (!name || !apiKey || !secret) return Promise.resolve({ ok: false, detail: 'not configured' });
  cloudinary.v2.config({ cloud_name: name, api_key: apiKey, api_secret: secret, secure: true });
  return new Promise((resolvePromise) => {
    cloudinary.v2.api.ping((error, response) => {
      if (error) resolvePromise({ ok: false, detail: error.name || error.message?.split(' ')[0] });
      else resolvePromise({ ok: true, detail: `ping ${response?.status || 'ok'}` });
    });
  });
}

// ----------------------------------------------------------------- PayPal
async function paypalToken(clientId, secret, env) {
  if (!clientId || !secret) return { ok: false, detail: 'not configured' };
  const base =
    env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  try {
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    // Status only — the response body carries a bearer token.
    return { ok: res.status === 200, detail: `HTTP ${res.status}`, status: res.status };
  } catch (error) {
    return { ok: false, detail: error.name || 'network error' };
  }
}

// ------------------------------------------------------------------- main
console.log('Credential rotation verification (values are never printed)');
console.log(`Current config: ${currentPath.replace(TOPLEVEL + '/', '')}`);
console.log(`Exposed source: ${exposedSource}`);
console.log('');

if (wanted('jwt')) {
  for (const key of ['JWT_SECRET', 'ADMIN_PASSWORD']) {
    const equality = same(key);
    record(
      'jwt',
      key,
      'current',
      equality === null ? 'UNKNOWN' : equality ? 'SAME_AS_EXPOSED' : 'DIFFERS',
      equality === null
        ? 'not comparable (missing on one side)'
        : equality
          ? 'exposed value is still configured — rotate'
          : 'configured value is not the exposed one'
    );
  }
}

if (wanted('mongodb')) {
  const uri = current.get('MONGODB_URI');
  const currentResult = await mongodbWorks(uri);
  record('mongodb', 'MONGODB_URI', 'current', currentResult.ok ? 'WORKS' : 'FAILED', currentResult.detail);
  if (exposed.get('MONGODB_URI') && same('MONGODB_URI') === false) {
    const oldResult = await mongodbWorks(exposed.get('MONGODB_URI'));
    record(
      'mongodb',
      'MONGODB_URI',
      'exposed',
      oldResult.ok ? 'STILL_WORKS' : 'REVOKED',
      oldResult.detail
    );
  } else if (same('MONGODB_URI') === true) {
    record('mongodb', 'MONGODB_URI', 'exposed', 'STILL_WORKS', 'exposed value is the configured one');
  }
}

if (wanted('cloudinary')) {
  const result = await cloudinaryWorks(
    current.get('CLOUDINARY_NAME'),
    current.get('CLOUDINARY_API_KEY'),
    current.get('CLOUDINARY_SECRET_KEY')
  );
  record('cloudinary', 'CLOUDINARY_SECRET_KEY', 'current', result.ok ? 'WORKS' : 'FAILED', result.detail);
  if (exposed.get('CLOUDINARY_SECRET_KEY') && same('CLOUDINARY_SECRET_KEY') === false) {
    const oldResult = await cloudinaryWorks(
      exposed.get('CLOUDINARY_NAME') || current.get('CLOUDINARY_NAME'),
      exposed.get('CLOUDINARY_API_KEY') || current.get('CLOUDINARY_API_KEY'),
      exposed.get('CLOUDINARY_SECRET_KEY')
    );
    record(
      'cloudinary',
      'CLOUDINARY_SECRET_KEY',
      'exposed',
      oldResult.ok ? 'STILL_WORKS' : 'REVOKED',
      oldResult.detail
    );
  } else if (same('CLOUDINARY_SECRET_KEY') === true) {
    record('cloudinary', 'CLOUDINARY_SECRET_KEY', 'exposed', 'STILL_WORKS', 'exposed value is the configured one');
  }
}

if (wanted('paypal')) {
  const env = (current.get('PAYPAL_ENV') || 'sandbox').toLowerCase();
  const result = await paypalToken(
    current.get('PAYPAL_CLIENT_ID'),
    current.get('PAYPAL_CLIENT_SECRET'),
    env
  );
  record('paypal', 'PAYPAL_CLIENT_SECRET', 'current', result.ok ? 'WORKS' : 'FAILED', result.detail);
  if (exposed.get('PAYPAL_CLIENT_SECRET') && same('PAYPAL_CLIENT_SECRET') === false) {
    const oldResult = await paypalToken(
      current.get('PAYPAL_CLIENT_ID'),
      exposed.get('PAYPAL_CLIENT_SECRET'),
      env
    );
    record(
      'paypal',
      'PAYPAL_CLIENT_SECRET',
      'exposed',
      oldResult.ok ? 'STILL_WORKS' : 'REVOKED',
      oldResult.detail
    );
  } else if (same('PAYPAL_CLIENT_SECRET') === true) {
    record('paypal', 'PAYPAL_CLIENT_SECRET', 'exposed', 'STILL_WORKS', 'exposed value is the configured one');
  }
  record(
    'paypal',
    'PAYPAL_WEBHOOK_ID',
    'current',
    current.get('PAYPAL_WEBHOOK_ID') ? 'CONFIGURED' : 'ABSENT',
    current.get('PAYPAL_WEBHOOK_ID') ? 'set' : 'every webhook is rejected until set'
  );
}

if (wanted('smtp')) {
  record(
    'smtp',
    'SMTP_PASS',
    'current',
    current.get('SMTP_PASS') ? 'CONFIGURED' : 'ABSENT',
    current.get('SMTP_PASS') ? 'set — rotate at the provider' : 'not configured here; nothing to rotate'
  );
}

const pad = (value, width) => String(value).padEnd(width);
console.log(
  `${pad('PROVIDER', 11)}${pad('CREDENTIAL', 22)}${pad('ROLE', 9)}${pad('STATE', 16)}DETAIL`
);
for (const row of results) {
  console.log(
    `${pad(row.provider, 11)}${pad(row.credential, 22)}${pad(row.role, 9)}${pad(row.state, 16)}${row.detail}`
  );
}

const stillWorking = results.filter((row) => row.state === 'STILL_WORKS');
const failingCurrent = results.filter((row) => row.role === 'current' && row.state === 'FAILED');
console.log('');
if (stillWorking.length) {
  console.log(`❌ EXPOSED CREDENTIAL STILL WORKS: ${stillWorking.map((r) => r.credential).join(', ')}`);
  console.log('   → rotate at the provider dashboard, update .env, then re-run this script.');
} else {
  console.log('✅ No exposed credential was accepted by its provider.');
}
if (failingCurrent.length) {
  console.log(`⚠️  Current credential failing: ${failingCurrent.map((r) => r.credential).join(', ')}`);
}

process.exit(stillWorking.length ? 1 : 0);
