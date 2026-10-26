#!/usr/bin/env node
// Dangling git-object credential audit (AGENTS.md trap 22).
//
// `scan-secrets.mjs --history` walks REFS, so it cannot see unreachable
// objects. A checkout can therefore pass every "history is clean" gate while
// `.git/objects` still holds a blob with a live credential — that is exactly
// what happened in this repository on 2026-10-26 (two dangling blobs, one with
// a live JWT secret, admin password, MongoDB Atlas URI and Cloudinary secret).
//
// This script is READ-ONLY: it never rewrites history, never writes to .git and
// never prints a credential value. For every unreachable blob it reports the
// variable NAME, the value LENGTH and whether that value still equals the
// value currently configured in `.env`:
//
//   LIVE    -> identical to the current config: an unreachable object still
//              contains a working credential. Rotate, then purge.
//   STALE   -> differs from the current config (already rotated here).
//   UNKNOWN -> the key is not set in the current config, so equality cannot be
//              decided; treated as not-live but reported.
//
// Exit codes: 0 = no unreachable object holds a current credential value
//             1 = at least one LIVE value found (or credential-shaped content
//                 in a blob while no .env baseline is available)
//             2 = the audit itself could not run
//
// Usage
//   node scripts/audit-dangling-blobs.mjs                 # uses backend/.env
//   node scripts/audit-dangling-blobs.mjs --env path/.env
//   node scripts/audit-dangling-blobs.mjs --json          # machine-readable
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeText } from './scan-secrets.mjs';

const TOPLEVEL = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: dirname(dirname(fileURLToPath(import.meta.url))), // backend/
  encoding: 'utf8',
}).trim();

// Keys whose value must never be readable from an unreachable object. Includes
// non-secret identifiers (ADMIN_EMAIL, PAYPAL_CLIENT_ID, CLOUDINARY_NAME) so the
// report can state, per credential, whether the exposed copy is still in use.
export const CREDENTIAL_KEYS = [
  'JWT_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_PAYEE_EMAIL',
  'MONGODB_URI',
  'CLOUDINARY_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_SECRET_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
];

// Identifiers are not secrets; they are reported separately so a reader can
// tell "public by design" from "must rotate".
const IDENTIFIER_KEYS = new Set([
  'ADMIN_EMAIL',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_PAYEE_EMAIL',
  'CLOUDINARY_NAME',
  'CLOUDINARY_API_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'EMAIL_FROM',
]);

/** Strip surrounding quotes and an unquoted trailing comment. */
function cleanValue(raw) {
  const value = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(value);
  if (quoted) return quoted[2];
  return value.split(/\s+#/)[0].trim();
}

/**
 * Extract `KEY=value`, `export KEY=value` and JSON `"KEY": "value"` pairs.
 * Pure so the unit suite can cover it without a git repository.
 * Returns Map<key, value> — callers must never print the value.
 */
export function extractAssignments(text, keys = CREDENTIAL_KEYS) {
  const wanted = new Set(keys);
  const found = new Map();

  for (const line of text.split(/\r?\n/)) {
    const env = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*[:=]\s*(.*)$/.exec(line);
    if (env) {
      const [, key, raw] = env;
      if (wanted.has(key) && !found.has(key)) {
        const value = cleanValue(raw);
        if (value) found.set(key, value);
      }
    }
    // Minified JSON / object literals: several pairs on one line.
    for (const match of line.matchAll(/"([A-Z][A-Z0-9_]*)"\s*:\s*"([^"]*)"/g)) {
      const [, key, value] = match;
      if (wanted.has(key) && !found.has(key) && value) found.set(key, value);
    }
  }
  return found;
}

/** Parse an env file into a plain object (never logged). */
export function parseEnvFile(text) {
  const values = new Map();
  for (const [key, value] of extractAssignments(text, [...CREDENTIAL_KEYS])) {
    values.set(key, value);
  }
  return values;
}

/**
 * Classify one blob's assignments against the current config.
 * `same` compares full values (a rotated MongoDB URI differs as a whole).
 */
export function classifyBlob(assignments, current) {
  const rows = [];
  for (const [key, value] of assignments) {
    const currentValue = current?.get(key);
    let state = 'UNKNOWN';
    if (currentValue !== undefined) state = currentValue === value ? 'LIVE' : 'STALE';
    rows.push({
      key,
      length: value.length,
      state,
      identifier: IDENTIFIER_KEYS.has(key),
    });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Fold per-blob rows into the report the CLI prints and the exit code uses.
 * A credential is LIVE if ANY unreachable copy still equals the current value.
 */
export function summarize(blobs, hasBaseline) {
  const byKey = new Map();
  for (const blob of blobs) {
    for (const row of blob.rows) {
      const entry = byKey.get(row.key) || {
        key: row.key,
        identifier: row.identifier,
        states: new Set(),
        lengths: new Set(),
        blobs: new Set(),
      };
      entry.states.add(row.state);
      entry.lengths.add(row.length);
      entry.blobs.add(blob.sha.slice(0, 8));
      byKey.set(row.key, entry);
    }
  }

  const keys = [...byKey.values()]
    .map((entry) => ({
      key: entry.key,
      identifier: entry.identifier,
      live: entry.states.has('LIVE'),
      states: [...entry.states].sort(),
      lengths: [...entry.lengths].sort((a, b) => a - b),
      blobs: [...entry.blobs].sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const live = keys.filter((k) => k.live && !k.identifier);
  const liveIdentifiers = keys.filter((k) => k.live && k.identifier);
  const staleOrUnknown = keys.filter((k) => !k.live);

  // Fail closed: with no `.env` baseline, "STALE" cannot be proven, so any
  // credential-shaped assignment keeps the gate red.
  const unverifiable = hasBaseline ? [] : keys.filter((k) => !k.identifier);

  return { keys, live, liveIdentifiers, staleOrUnknown, unverifiable };
}

function listUnreachable() {
  let out = '';
  try {
    out = execFileSync('git', ['fsck', '--unreachable', '--no-reflogs'], {
      cwd: TOPLEVEL,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    // fsck exits non-zero on dangling objects in some git versions; keep stdout.
    out = error.stdout ? String(error.stdout) : '';
    if (!out) throw error;
  }
  const objects = [];
  for (const line of out.split('\n')) {
    const match = /^unreachable (\w+) ([0-9a-f]{40})$/.exec(line.trim());
    if (match) objects.push({ type: match[1], sha: match[2] });
  }
  return objects;
}

function readBlob(sha, limit) {
  const size = Number(
    execFileSync('git', ['cat-file', '-s', sha], { cwd: TOPLEVEL, encoding: 'utf8' }).trim()
  );
  if (size > limit) return { text: null, size };
  const text = execFileSync('git', ['cat-file', '-p', sha], {
    cwd: TOPLEVEL,
    encoding: 'utf8',
    maxBuffer: limit * 2,
  });
  return { text, size };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const envFlag = argv.indexOf('--env');
  const envPath =
    envFlag !== -1 && argv[envFlag + 1]
      ? resolve(argv[envFlag + 1])
      : join(TOPLEVEL, 'backend/.env');

  let current = null;
  if (existsSync(envPath)) current = parseEnvFile(readFileSync(envPath, 'utf8'));

  const objects = listUnreachable();
  const blobs = objects.filter((object) => object.type === 'blob');
  const limit = 1024 * 1024;
  const scanned = [];
  let skipped = 0;

  for (const blob of blobs) {
    const { text, size } = readBlob(blob.sha, limit);
    if (text === null) {
      skipped += 1;
      continue;
    }
    const assignments = extractAssignments(text);
    // Reuse the repo's single pattern set so a private key / AWS key / JWT in
    // an unreachable blob is reported the same way as anywhere else. A blob may
    // carry a credential-shaped value with NO `KEY=` assignment (e.g. a raw
    // token in a log), so patterns alone also make a blob reportable.
    const patterns = [...new Set(
      analyzeText(text, `dangling:${blob.sha.slice(0, 8)}`)
        .map((finding) => finding.kind)
        // The scanner already decided these are real-looking; keep only the
        // non-assignment rules here because assignments are classified below.
        .filter((kind) => !kind.startsWith('assignment:'))
    )];
    if (assignments.size === 0 && patterns.length === 0) continue;
    scanned.push({
      sha: blob.sha,
      size,
      rows: classifyBlob(assignments, current),
      patterns,
    });
  }

  const report = summarize(scanned, current !== null);

  if (json) {
    console.log(
      JSON.stringify(
        {
          toplevel: TOPLEVEL,
          baseline: current ? 'loaded' : 'absent',
          unreachable: {
            total: objects.length,
            blobs: blobs.length,
            skippedTooLarge: skipped,
          },
          blobsWithCredentials: scanned.map((b) => ({
            sha: b.sha.slice(0, 8),
            size: b.size,
            patterns: b.patterns,
            keys: b.rows.map((r) => ({ key: r.key, length: r.length, state: r.state })),
          })),
          live: report.live.map((k) => k.key),
          liveIdentifiers: report.liveIdentifiers.map((k) => k.key),
          staleOrUnknown: report.staleOrUnknown.map((k) => ({ key: k.key, states: k.states })),
        },
        null,
        2
      )
    );
  } else {
    console.log(`Dangling-object audit (read-only) — repo: ${TOPLEVEL}`);
    console.log(
      `Unreachable objects: ${objects.length} (blobs ${blobs.length}, others ${objects.length - blobs.length})` +
        (skipped ? ` · skipped >1 MiB: ${skipped}` : '')
    );
    console.log(`Current-config baseline: ${current ? envPath.replace(TOPLEVEL + '/', '') : 'ABSENT'}`);
    console.log(`Blobs carrying credential-shaped content: ${scanned.length}`);
    for (const blob of scanned) {
      const keys = blob.rows.map((r) => `${r.key}[${r.length}]:${r.state}`).join(', ');
      const patterns = blob.patterns.length ? `patterns: ${blob.patterns.join(',')}` : '';
      console.log(`  ${blob.sha.slice(0, 8)} (${blob.size}B) ${[keys, patterns].filter(Boolean).join(' · ')}`);
    }
    console.log('');
    if (report.live.length) {
      console.log(
        `❌ LIVE values still readable from unreachable objects: ${report.live.map((k) => k.key).join(', ')}`
      );
    } else {
      console.log('✅ No unreachable object holds a current value of a secret credential.');
    }
    if (report.liveIdentifiers.length) {
      console.log(
        `ℹ️  Identifiers (not secrets) still matching: ${report.liveIdentifiers.map((k) => k.key).join(', ')}`
      );
    }
    if (report.staleOrUnknown.length) {
      console.log(
        `ℹ️  Already rotated / not comparable: ${report.staleOrUnknown
          .map((k) => `${k.key}(${k.states.join('/')})`)
          .join(', ')}`
      );
    }
    if (!current) {
      console.log('⚠️  No .env baseline: equality cannot be proven, failing closed for secret keys.');
    }
    console.log('');
    console.log('Purge (owner-run, irreversible, NOT a history rewrite):');
    console.log('  git reflog expire --expire=now --all && git gc --prune=now');
  }

  const failed = report.live.length > 0 || report.unverifiable.length > 0;
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`❌ dangling-object audit could not run: ${error.message}`);
    process.exit(2);
  }
}
