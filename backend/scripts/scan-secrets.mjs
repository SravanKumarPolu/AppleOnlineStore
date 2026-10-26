#!/usr/bin/env node
// Secret scanner — working tree AND git history.
//
// The baseline's .gitignore fix stops FUTURE accidents. This script answers the
// other question: has a real credential ever been committed? It is read-only
// (never rewrites history) and never prints a suspected value — only the
// variable name, file and commit.
//
// Usage
//   node scripts/scan-secrets.mjs            # tracked files only (fast, CI-safe)
//   node scripts/scan-secrets.mjs --history  # also scan every commit's diff
//
// Exit codes: 0 = clean · 1 = at least one real-looking secret found.
//
// FIXTURE EXCLUSIONS: test files legitimately contain fabricated credentials,
// but "it is a test file" must not be a blind spot — a real secret pasted into
// a spec would previously have been ignored entirely. Fixture paths are now
// scanned for assignments too; only values that are clearly synthetic (short,
// or containing test/fake/sample/etc.) are waived. Credential-SHAPED patterns
// (private keys, PayPal secrets, AWS keys, …) are never waived.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// git listing/history commands are CWD-SCOPED: `git ls-files` and `git log`
// run from backend/ only ever see backend/** — the rest of the monorepo would
// be silently unscanned (this exact bug shipped once: a real secret in
// frontend/.env.example passed `npm run security:secrets`). Anchor every git
// call and every file read at the REPO TOPLEVEL so the gate is whole-repo
// regardless of where npm ran it.
const TOPLEVEL = execSync('git rev-parse --show-toplevel', {
  cwd: dirname(dirname(fileURLToPath(import.meta.url))), // backend/
  encoding: 'utf8',
}).trim();

// Values that are obviously templates — same spirit as
// config/startupValidation.js's placeholder detection.
const PLACEHOLDER = /^(your|change|change-me|replace|placeholder|example|todo|fixme|secure-|test-|e2e-|<|\$\{)/i;

// Values a fixture may legitimately contain. Anything longer/random that does
// not match this is reported even inside a test file.
const SYNTHETIC_VALUE =
  /(test|spec|e2e|dummy|fake|sample|fixture|stub|mock|unit|integration|placeholder|example|secret|jwt|password)/i;

const PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'paypal-secret', re: /\bE[A-Za-z0-9_-]{60,}\b/ },
  { id: 'stripe-live', re: /\bsk_live_[0-9A-Za-z]{16,}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // Test suites must fabricate JWTs to prove redaction, so this generic rule
  // is skipped in fixtures. Credential-shaped patterns above are not.
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, skipInFixtures: true },
];

// `NAME=value` assignments for the credentials this app actually uses.
// PAYPAL_CLIENT_ID / PAYPAL_WEBHOOK_ID are identifiers, not secrets, and are
// covered by the stricter pattern list instead.
const ASSIGNMENT =
  /(JWT_SECRET|ADMIN_PASSWORD|PAYPAL_CLIENT_SECRET|SMTP_PASS|CLOUDINARY_SECRET_KEY|MONGODB_URI)\s*[:=]\s*['"]?([^'"\s#]{6,})/g;

// Files where literal values are fixtures by construction, not configuration.
const FIXTURE_PATHS = [
  /(^|\/)__tests__\//,
  /\.spec\.(js|mjs|ts)$/,
  /(^|\/)scripts\/verify-startup\.mjs$/, // sets synthetic env for a boot check
  /(^|\/)env\.example$/, // superseded template
  /(^|\/)\.env\.example$/, // documented templates
];

export const isFixturePath = (file) => FIXTURE_PATHS.some((re) => re.test(file));

export const isPlaceholder = (value) =>
  PLACEHOLDER.test(value) ||
  /placeholder|example\.com|your-|sandbox|localhost:27017/i.test(value) ||
  // Synthetic values used in tests/scripts.
  /^(test|e2e|dummy|fake|sample)[-_]/i.test(value) ||
  value.length < 20;

// A MongoDB URI is only a finding when it carries credentials.
const uriHasCredentials = (value) => /^mongodb(\+srv)?:\/\/[^/@]+:[^/@]+@/.test(value);

/**
 * An EXPIRED JWT can never authenticate (servers enforce `exp`), so it is not
 * a live credential. Decode the payload and waive only provably-expired
 * tokens — e.g. a fabricated mock retained in an agent checkpoint snapshot.
 * Undecodable tokens fail CLOSED (treated as live).
 */
export function isExpiredJwt(token) {
  const payload = token.split('.')[1];
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return typeof claims.exp === 'number' && claims.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

/**
 * Analyse one text blob. Pure (no I/O), so the test suite can prove that a
 * REAL-looking value inside a fixture path is still reported.
 *
 * Returns findings as { where, kind, detail } — never the value itself.
 */
export function analyzeText(text, where) {
  const findings = [];
  const fixture = isFixturePath(where);

  for (const { id, re, skipInFixtures } of PATTERNS) {
    if (fixture && skipInFixtures) continue;
    const match = re.exec(text);
    if (!match) continue;
    if (id === 'jwt' && isExpiredJwt(match[0])) continue;
    findings.push({ where, kind: id, detail: 'pattern match' });
  }

  for (const match of text.matchAll(ASSIGNMENT)) {
    const [, name, value] = match;
    if (isPlaceholder(value)) continue;
    // Reject obvious non-secrets: env var references, shell expansion, booleans.
    if (/^(true|false|null|undefined|\$|\{\{|process\.env\b)/i.test(value)) continue;
    if (name === 'MONGODB_URI' && !uriHasCredentials(value)) continue;
    // Fixtures: waiver only for values that are obviously fabricated. A long,
    // random value pasted into a spec is reported like anywhere else.
    if (fixture && (SYNTHETIC_VALUE.test(value) || value.length < 24)) continue;
    findings.push({ where, kind: `assignment:${name}`, detail: 'non-placeholder value' });
  }

  return findings;
}

function scanWorkingTree() {
  const files = execSync('git ls-files', { cwd: TOPLEVEL, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // Lock files and images are noise; .env files must never be tracked.
    .filter((file) => !/package-lock\.json$|\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(file));

  const trackedEnv = files.filter((file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example'));
  const findings = trackedEnv.map((file) => ({
    where: file,
    kind: 'tracked-env-file',
    detail: 'a .env file is tracked by git',
  }));

  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(TOPLEVEL, file), 'utf8');
    } catch {
      continue; // binary/unreadable
    }
    findings.push(...analyzeText(text, file));
  }
  return findings;
}

function scanHistory() {
  // Diff every commit, but only the lines an assignment/pattern can hide in.
  const log = execSync('git log --all -p --no-color -- . ":(exclude)*package-lock.json"', {
    cwd: TOPLEVEL,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256,
  });

  const findings = [];
  let commit = 'unknown';
  let currentFile = 'unknown';
  for (const line of log.split('\n')) {
    const commitMatch = /^commit ([0-9a-f]{7,40})/.exec(line);
    if (commitMatch) commit = commitMatch[1].slice(0, 8);
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fileMatch) currentFile = fileMatch[1];
    if (!line.startsWith('+')) continue; // only added lines
    if (isFixturePath(currentFile)) continue;
    const added = line.slice(1);
    for (const { id, re } of PATTERNS) {
      const match = re.exec(added);
      if (!match) continue;
      // Same expiry rule as the tree scan: a provably expired JWT can never
      // authenticate, so a historical copy of one is not a live credential.
      if (id === 'jwt' && isExpiredJwt(match[0])) continue;
      findings.push({ where: `commit ${commit} (${currentFile})`, kind: id, detail: 'historical match' });
    }
    for (const match of added.matchAll(ASSIGNMENT)) {
      const [, name, value] = match;
      if (isPlaceholder(value)) continue;
      if (/^(true|false|null|undefined|\$|\{\{|process\.env\b)/i.test(value)) continue;
      if (name === 'MONGODB_URI' && !uriHasCredentials(value)) continue;
      findings.push({
        where: `commit ${commit} (${currentFile})`,
        kind: `assignment:${name}`,
        detail: 'historical value',
      });
    }
  }
  return findings;
}

function main() {
  const history = process.argv.includes('--history');
  console.log(`Scanning ${history ? 'working tree + full git history' : 'working tree'}…`);

  const findings = scanWorkingTree();
  if (history) findings.push(...scanHistory());

  if (findings.length === 0) {
    console.log('✅ No real-looking secrets found.');
    process.exit(0);
  }

  // Deduplicate identical findings (history repeats the same file many times).
  const unique = new Map();
  for (const finding of findings) {
    unique.set(`${finding.where}|${finding.kind}`, finding);
  }

  console.error(`❌ ${unique.size} finding(s) — values are intentionally NOT printed:`);
  for (const finding of [...unique.values()].slice(0, 60)) {
    console.error(`   - ${finding.kind} at ${finding.where} (${finding.detail})`);
  }
  if (unique.size > 60) console.error(`   … and ${unique.size - 60} more`);
  console.error('\nRotate any real credential that appears above, then purge it from history');
  console.error('(see docs/devops/07-CREDENTIAL-ROTATION-RUNBOOK.md). This script never rewrites history.');
  process.exit(1);
}

// Run only when executed directly (the unit test imports the pure helpers).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
