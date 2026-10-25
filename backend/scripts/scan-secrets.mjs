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
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HISTORY = process.argv.includes('--history');

// Values that are obviously templates — same spirit as
// config/startupValidation.js's placeholder detection.
const PLACEHOLDER = /^(your|change|change-me|replace|placeholder|example|todo|fixme|secure-|test-|e2e-|<|\$\{)/i;

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

const isFixturePath = (file) => FIXTURE_PATHS.some((re) => re.test(file));

const isPlaceholder = (value) =>
  PLACEHOLDER.test(value) ||
  /placeholder|example\.com|your-|sandbox|localhost:27017/i.test(value) ||
  // Synthetic values used in tests/scripts.
  /^(test|e2e|dummy|fake|sample)[-_]/i.test(value) ||
  value.length < 20;

// A MongoDB URI is only a finding when it carries credentials.
const uriHasCredentials = (value) => /^mongodb(\+srv)?:\/\/[^/@]+:[^/@]+@/.test(value);

const findings = [];

function scanText(text, where) {
  const fixture = isFixturePath(where);
  for (const { id, re, skipInFixtures } of PATTERNS) {
    if (fixture && skipInFixtures) continue;
    if (re.test(text)) findings.push({ where, kind: id, detail: 'pattern match' });
  }
  if (isFixturePath(where)) return; // fixtures documented above
  for (const match of text.matchAll(ASSIGNMENT)) {
    const [, name, value] = match;
    if (isPlaceholder(value)) continue;
    // Reject obvious non-secrets: env var references, shell expansion, booleans.
    if (/^(true|false|null|undefined|\$|\{\{)/i.test(value)) continue;
    if (name === 'MONGODB_URI' && !uriHasCredentials(value)) continue;
    findings.push({ where, kind: `assignment:${name}`, detail: 'non-placeholder value' });
  }
}

function scanWorkingTree() {
  const files = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // Lock files and images are noise; .env files must never be tracked.
    .filter((file) => !/package-lock\.json$|\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(file));

  const trackedEnv = files.filter((file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example'));
  for (const file of trackedEnv) {
    findings.push({ where: file, kind: 'tracked-env-file', detail: 'a .env file is tracked by git' });
  }

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // binary/unreadable
    }
    scanText(text, file);
  }
}

function scanHistory() {
  // Diff every commit, but only the lines an assignment/pattern can hide in.
  const log = execSync(
    'git log --all -p --no-color -- . ":(exclude)*package-lock.json"',
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 }
  );

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
      if (re.test(added)) findings.push({ where: `commit ${commit}`, kind: id, detail: 'historical match' });
    }
    for (const match of added.matchAll(ASSIGNMENT)) {
      const [, name, value] = match;
      if (isPlaceholder(value)) continue;
      if (/^(true|false|null|undefined|\$|\{\{)/i.test(value)) continue;
      if (name === 'MONGODB_URI' && !uriHasCredentials(value)) continue;
      findings.push({
        where: `commit ${commit} (${currentFile})`,
        kind: `assignment:${name}`,
        detail: 'historical value',
      });
    }
  }
}

console.log(`Scanning ${HISTORY ? 'working tree + full git history' : 'working tree'}…`);
scanWorkingTree();
if (HISTORY) scanHistory();

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
