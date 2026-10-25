#!/usr/bin/env node
// K-10 evidence pass: classify every backend production dependency by usage.
// Usage: node scripts/audit-deps-usage.mjs
// Exit 0 always; prints a classification table for human review.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const which = process.argv[2] === 'dev' ? 'devDependencies' : 'dependencies';
const deps = Object.keys(pkg[which] || {});
if (process.argv[2] === 'dev') {
  // devDeps may also be referenced by name in package.json's own scripts,
  // .husky/, lint-staged config etc. Scan package.json text itself.
  const self = readFileSync(join(root, 'package.json'), 'utf8');
  const extra = [];
  for (const dep of deps) if (new RegExp(`['"]${dep}['"]|\\b${dep}\\b`).test(self)) extra.push(dep);
  console.log(`self-referenced in package.json scripts/config: ${extra.join(', ') || '(none)'}`);
  if (existsSync(join(root, 'patches'))) console.log('patches/ dir EXISTS');
  else console.log('patches/ dir: absent');
}

// Collect candidate source files (skip node_modules, coverage, .git, logs, uploads)
const SKIP_DIRS = new Set(['node_modules', 'coverage', '.git', 'logs', 'uploads', 'patches']);
const EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && name !== '.eslintrc.json' && name !== '.eslintrc') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full);
    } else if (EXTS.has(name.slice(name.lastIndexOf('.'))) || name === '.eslintrc') {
      if (name !== 'package.json' && name !== 'package-lock.json') files.push(full);
    }
  }
})(root);

// Also include dotfile configs that matter
for (const cfg of ['.eslintrc.js', '.eslintrc.json', 'babel.config.json', 'babel.config.js', 'jest.config.js']) {
  try { files.push(join(root, cfg)); } catch { /* ignore */ }
}

const rows = [];
for (const dep of deps) {
  const esc = dep.replace(/[/\\]/g, '[/\\\\]');
  // Match: from 'pkg', require('pkg'), import('pkg'), from 'pkg/sub', plus
  // config-file references (eslint parserOptions.babelOptions.plugins etc.)
  const patterns = [
    new RegExp(`from\\s+['"]${esc}(/|['"])`),
    new RegExp(`require\\s*\\(\\s*['"]${esc}(/|['"])`),
    new RegExp(`import\\s*\\(\\s*['"]${esc}(/|['"])`),
    new RegExp(`['"]${esc}['"]`), // quoted name (eslint/jest/babel configs)
  ];
  const hits = { runtime: [], script: [], test: [], config: [] };
  for (const f of files) {
    let content;
    try { content = readFileSync(f, 'utf8'); } catch { continue; }
    if (!patterns.some((re) => re.test(content))) continue;
    const rel = relative(root, f);
    const bucket = rel.startsWith('scripts/')
      ? 'script'
      : rel.startsWith('__tests__') || /\.spec\./.test(rel)
        ? 'test'
        : /(?:^|\/)(?:\.eslintrc|babel\.config|jest\.config|eslint\.config)/.test(rel)
          ? 'config'
          : 'runtime';
    hits[bucket].push(rel);
  }
  const status = hits.runtime.length
    ? 'RUNTIME'
    : hits.script.length || hits.test.length || hits.config.length
      ? `only:${[hits.script.length && 'script', hits.test.length && 'test', hits.config.length && 'config'].filter(Boolean).join('+')}`
      : 'UNUSED';
  rows.push({ dep, status, where: [...hits.runtime.slice(0, 2), ...hits.script, ...hits.test.slice(0, 2), ...hits.config] });
}

const width = Math.max(...rows.map((r) => r.dep.length));
for (const r of rows.sort((a, b) => a.status.localeCompare(b.status))) {
  const where = r.where.length ? `  e.g. ${r.where.join(', ')}` : '';
  console.log(`${r.dep.padEnd(width)}  ${r.status.padEnd(14)}${where}`);
}
console.log(`\nTotal prod deps: ${rows.length}`);
console.log(`UNUSED candidates: ${rows.filter((r) => r.status === 'UNUSED').map((r) => r.dep).join(', ') || '(none)'}`);
