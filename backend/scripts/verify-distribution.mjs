#!/usr/bin/env node
// Distribution (ZIP) safety verifier.
//
// WHY: a previously shared NovaCart archive contained `backend/.env` with
// populated credentials. It was git-ignored, but an archive built from the
// WORKING DIRECTORY happily included it. This script validates what a release
// archive would contain, refuses credential-bearing files, and only then
// builds the ZIP from verified Git-tracked content (`git archive`).
//
// Usage
//   node scripts/verify-distribution.mjs --check
//       Validate the tracked file set + contents. Exit 0 = safe to package.
//   node scripts/verify-distribution.mjs --out ../NovaCart-src.zip
//       Validate, then create the archive from HEAD (requires a clean tree).
//   node scripts/verify-distribution.mjs --check --root /path/to/repo
//       Run against another checkout (used by the test suite).
//
// Exit codes: 0 = safe / archive created · 1 = unsafe or refused · 2 = usage.
//
// Secret VALUES are never printed — only the path and the finding kind.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from './scan-secrets.mjs';

// Paths that must never ship, with the one legitimate exception: templates.
const ALLOWED_ENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template)$/i;

const RULES = [
  {
    id: 'env-file',
    detail: 'a populated .env file (must not be distributed)',
    re: /(^|\/)\.env(\.|$)/i,
    except: ALLOWED_ENV_TEMPLATE,
  },
  { id: 'private-key', detail: 'private key / keystore material', re: /\.(pem|key|p12|pfx|jks|keystore)$/i },
  { id: 'ssh-key', detail: 'SSH private key material', re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i },
  { id: 'log-file', detail: 'log file (may contain runtime data)', re: /\.log$/i },
  { id: 'nested-archive', detail: 'nested archive', re: /\.(zip|tar|tgz|tar\.gz|7z|rar)$/i },
  {
    id: 'cache-or-build',
    detail: 'dependency/build/test artifact directory',
    re: /(^|\/)(node_modules|coverage|\.cache|dev-dist|dist|build|test-results|playwright-report|blob-report)\//i,
  },
  { id: 'os-junk', detail: 'OS metadata file', re: /(^|\/)(\.DS_Store|Thumbs\.db)$/i },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|mp4|mov)$/i;

// Generated lock files legitimately contain long base64 integrity hashes that
// match credential-shaped patterns (e.g. a PayPal-secret-like `E…` string).
// They cannot carry configuration secrets, and the main secret scanner excludes
// them for the same reason.
const GENERATED_LOCK = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

/** Classify one repository-relative path. Returns null when allowed. */
export function classifyPath(filePath) {
  for (const rule of RULES) {
    if (!rule.re.test(filePath)) continue;
    if (rule.except && rule.except.test(filePath)) continue;
    return { kind: rule.id, detail: rule.detail, path: filePath };
  }
  return null;
}

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Tracked file list, in a stable order. */
export function listTrackedFiles(root) {
  return git(root, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort();
}

/**
 * Validate a file set without creating anything.
 * Returns { checked, findings } — findings never contain file contents.
 */
export function verifyDistribution({ root = process.cwd() } = {}) {
  const findings = [];
  const files = listTrackedFiles(root);

  for (const file of files) {
    const pathFinding = classifyPath(file);
    if (pathFinding) {
      findings.push(pathFinding);
      continue; // no need to read a file that must not ship
    }
    if (BINARY_EXT.test(file)) continue;
    if (GENERATED_LOCK.test(file)) continue; // integrity hashes, not config

    let text;
    try {
      text = readFileSync(resolve(root, file), 'utf8');
    } catch {
      continue; // unreadable/binary
    }
    if (text.includes('\0')) continue; // binary

    for (const finding of analyzeText(text, file)) {
      findings.push({
        kind: finding.kind,
        detail: finding.detail,
        path: finding.where, // path only — never the value
      });
    }
  }

  return { checked: files.length, findings };
}

function printFindings(findings) {
  console.error(`❌ ${findings.length} distribution finding(s) — values are never printed:`);
  for (const finding of findings.slice(0, 60)) {
    console.error(`   - ${finding.kind} at ${finding.path} (${finding.detail})`);
  }
  if (findings.length > 60) console.error(`   … and ${findings.length - 60} more`);
  console.error('\nRemove the file(s) from the tracked set (and rotate any real credential).');
  console.error('This script does not rewrite history and does not delete old archives.');
}

function assertCleanWorktree(root) {
  const status = git(root, ['status', '--porcelain']).trim();
  if (status) {
    console.error('❌ Working tree is not clean — a git-archive ZIP would not match the validated content.');
    console.error('   Commit (or stash) the changes, then re-run. Uncommitted files cannot be released safely.');
    process.exit(1);
  }
}

function createArchive(root, outPath) {
  const absolute = resolve(outPath);
  mkdirSync(dirname(absolute), { recursive: true });
  git(root, ['archive', '--format=zip', `--output=${absolute}`, 'HEAD']);
  const size = statSync(absolute).size;
  console.log(`✅ Archive created: ${absolute} (${(size / 1024).toFixed(1)} KiB, from HEAD)`);
}

function gitToplevel(fallback) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: fallback, encoding: 'utf8' }).trim();
  } catch {
    return fallback; // not inside a repository — let the validation fail naturally
  }
}

function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = args.indexOf(flag);
    return index !== -1 ? args[index + 1] : undefined;
  };
  // Default to the REPO TOPLEVEL, never the process cwd: `git ls-files` and
  // `git archive` are cwd-scoped, so running `npm run security:distribution`
  // from backend/ must not silently validate (and ship) only backend/**.
  const root = resolve(valueOf('--root') || gitToplevel(process.cwd()));
  const out = valueOf('--out');

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: verify-distribution.mjs [--check] [--out <zip>] [--root <repo>]');
    process.exit(0);
  }

  if (!existsSync(root)) {
    console.error(`❌ --root does not exist: ${root}`);
    process.exit(2);
  }

  // Refuse to build an archive from a working tree whose content differs from
  // what was validated (git archive only ships HEAD).
  if (out) assertCleanWorktree(root);

  const { checked, findings } = verifyDistribution({ root });
  if (findings.length > 0) {
    printFindings(findings);
    process.exit(1);
  }

  console.log(`✅ Distribution source clean: ${checked} tracked file(s) inspected, no credentials found.`);

  if (out) createArchive(root, out);
  else console.log('Run with --out <file.zip> to build the release archive from HEAD.');
}

// Run only when executed directly (the test suite imports the pure helpers).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
