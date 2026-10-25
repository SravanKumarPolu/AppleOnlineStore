#!/usr/bin/env node
// K-10 continuation: find zero-reference source files in a Vite app.
// A file is "dead" when no other file (src/, e2e/, configs) mentions its
// module basename. Entry points (main/App), tests, and test utils are
// excluded from candidacy. Usage: node scripts/find-dead-files.mjs [appDir]

import { execSync } from 'node:child_process';
import { basename } from 'node:path';

const appDir = process.argv[2] || '.';
const sh = (cmd) => {
  try { return execSync(cmd, { cwd: appDir, encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

const all = sh('find src -type f -name "*.tsx" -o -type f -name "*.ts" -o -type f -name "*.jsx" -o -type f -name "*.js"')
  .split('\n').filter(Boolean);
const entries = new Set(['src/main.tsx', 'src/main.jsx', 'src/App.tsx', 'src/App.jsx']);
const dead = [];
for (const f of all) {
  if (entries.has(f) || f.includes('__tests__') || /\.test\./.test(f) || /testUtils|setup/.test(f)) continue;
  const base = basename(f).replace(/\.(tsx|ts|jsx|js)$/, '');
  const hits = sh(`rg -l ${base} src/ e2e/ index.html vite.config.ts 2>/dev/null || true`)
    .split('\n').filter((x) => x && x !== f);
  if (hits.length === 0) dead.push(f);
}
console.log(dead.length ? `DEAD (${dead.length}):\n  ${dead.join('\n  ')}` : 'No zero-reference files found.');
