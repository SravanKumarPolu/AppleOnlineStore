// Distribution archive safety (the ZIP that leaked backend/.env).
//
// These tests build throwaway Git repositories and drive the real CLI, so the
// exit codes and the "never print the value" guarantee are exercised, not
// assumed. The unsafe values are fabricated at runtime so this spec's own
// source never contains a credential-shaped assignment.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyPath, verifyDistribution } from '../scripts/verify-distribution.mjs';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(backendRoot, 'scripts/verify-distribution.mjs');

let repo;

function git(args, cwd = repo) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function write(relativePath, contents) {
  const target = join(repo, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function makeRepo(files) {
  repo = mkdtempSync(join(tmpdir(), 'novacart-dist-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'dist@test.local'], repo);
  git(['config', 'user.name', 'Distribution Test'], repo);
  for (const [path, contents] of Object.entries(files)) write(path, contents);
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'fixture'], repo);
  return repo;
}

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      ...(cwd ? { cwd } : {}),
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return { status: error.status, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

beforeEach(() => {
  repo = null;
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('verify-distribution — path policy', () => {
  it('rejects populated .env and key material, but allows templates', () => {
    expect(classifyPath('backend/.env')?.kind).toBe('env-file');
    expect(classifyPath('backend/.env.production')?.kind).toBe('env-file');
    expect(classifyPath('backend/.env.example')).toBeNull();
    expect(classifyPath('frontend/.env.sample')).toBeNull();
    expect(classifyPath('certs/server.pem')?.kind).toBe('private-key');
    expect(classifyPath('id_ed25519')?.kind).toBe('ssh-key');
    expect(classifyPath('node_modules/pkg/index.js')?.kind).toBe('cache-or-build');
    expect(classifyPath('docs/readme.md')).toBeNull();
  });
});

describe('verify-distribution — CLI behaviour', () => {
  it('passes a clean source tree with an .env.example template', () => {
    makeRepo({
      'README.md': '# NovaCart\n',
      'backend/.env.example': 'JWT_SECRET=your-super-secret-jwt-key-here\n',
      'backend/src/app.js': 'export const ok = true;\n',
    });

    const result = run(['--check', '--root', repo]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/clean/i);
  });

  it('rejects a tracked .env and never prints its value', () => {
    // Fabricated at runtime; no credential-shaped assignment in this source.
    const fabricated = ['Zx9Qw7Er5Ty2Ui4Op6As8Df0Gh1Jk3Lm'].join('');
    makeRepo({
      'backend/.env': `JWT_SECRET=${fabricated}\n`,
      'backend/src/app.js': 'export const ok = true;\n',
    });

    const result = run(['--check', '--root', repo]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('backend/.env');
    expect(result.stderr).not.toContain(fabricated);
  });

  it('rejects private key files', () => {
    makeRepo({
      'certs/server.pem': `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nnot-a-real-key\n${['-----END', 'PRIVATE KEY-----'].join(' ')}\n`,
      'src/app.js': 'export const ok = true;\n',
    });

    const result = run(['--check', '--root', repo]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/private-key/);
  });

  it('rejects tracked dependency/build directories', () => {
    makeRepo({
      'node_modules/pkg/index.js': 'module.exports = {};\n',
      'src/app.js': 'export const ok = true;\n',
    });

    const result = run(['--check', '--root', repo]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/cache-or-build/);
  });

  it('builds the archive from HEAD only after validation, excluding .env.example-safe content', () => {
    makeRepo({
      'README.md': '# NovaCart\n',
      'backend/.env.example': 'JWT_SECRET=your-super-secret-jwt-key-here\n',
      'backend/src/app.js': 'export const ok = true;\n',
    });

    const out = join(repo, '..', `novacart-${Date.now()}.zip`);
    const result = run(['--out', out, '--root', repo]);
    try {
      expect(result.status).toBe(0);
      expect(existsSync(out)).toBe(true);

      // `unzip` ships with macOS and most CI images; if absent, the successful
      // exit + existing file is still meaningful (git archive is the producer).
      let entries = '';
      try {
        entries = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' });
      } catch {
        entries = '';
      }
      if (entries) {
        expect(entries).toContain('backend/.env.example');
        expect(entries).not.toMatch(/(^|\/)\.env(\n|$)/);
      }
    } finally {
      rmSync(out, { force: true });
    }
  });

  it('refuses to build an archive from a dirty working tree', () => {
    makeRepo({ 'src/app.js': 'export const ok = true;\n' });
    writeFileSync(join(repo, 'uncommitted.txt'), 'not validated\n');

    const out = join(repo, '..', `novacart-dirty-${Date.now()}.zip`);
    const result = run(['--out', out, '--root', repo]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not clean/i);
    expect(existsSync(out)).toBe(false);
  });

  it('detects an embedded credential inside an otherwise allowed text file', () => {
    const fabricated = ['Q7m2Pz9Lx4Vb8Nc3Rt6Wy1Kg5'].join('');
    makeRepo({
      'src/config.js': `export const ADMIN_PASSWORD=${fabricated};\n`,
    });

    const { findings } = verifyDistribution({ root: repo });
    expect(findings.map((finding) => finding.kind)).toContain('assignment:ADMIN_PASSWORD');
  });

  it('does not flag lock-file integrity hashes as credentials', () => {
    // Real lock files contain long base64 sha512 integrity strings; some begin
    // with "E" and match the PayPal-secret shape. They must not fail the gate.
    const integrity = `sha512-E${'a'.repeat(80)}==`;
    makeRepo({
      'package-lock.json': JSON.stringify({ packages: { '': {}, x: { integrity } } }, null, 2),
      'src/app.js': 'export const ok = true;\n',
    });

    const result = run(['--check', '--root', repo]);
    expect(result.status).toBe(0);
  });

  it('scans the WHOLE repo even when launched from a subdirectory (cwd-scoped git bug)', () => {
    // Regression: `git ls-files` is cwd-scoped, so running the CLI from
    // backend/ once silently validated only backend/** while frontend secrets
    // sailed through. Without --root the CLI must anchor at the repo toplevel.
    const fabricated = ['K4m9Qw2Er5Ty8Ui1Op7As3Df6Gh0Jk2Lm'].join('');
    makeRepo({
      'backend/src/app.js': 'export const ok = true;\n',
    'frontend/src/config.js': `JWT_SECRET=${fabricated}\n`,
    });

    const result = run(['--check'], join(repo, 'backend'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('frontend/src/config.js');
  });

  it('archives the WHOLE repo when launched from a subdirectory', () => {
    makeRepo({
      'backend/src/app.js': 'export const ok = true;\n',
      'frontend/src/main.js': 'export const boot = true;\n',
    });

    const out = join(repo, '..', `novacart-full-${Date.now()}.zip`);
    const result = run(['--out', out], join(repo, 'backend'));
    try {
      expect(result.status).toBe(0);
      const entries = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' });
      expect(entries).toContain('frontend/src/main.js');
    } finally {
      rmSync(out, { force: true });
    }
  });
});
