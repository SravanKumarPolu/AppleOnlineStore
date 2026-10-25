// Backend "build" — syntax/parse verification for a no-transpile Node service.
//
// The backend has no compiler, so `npm run build` used to be an `echo`
// placeholder: it could never fail, and a syntax error only surfaced at
// runtime. This walks every first-party JavaScript file and runs Node's own
// parser over it (`node --check`), which fails on syntax errors and is
// side-effect free (nothing is imported or executed).
//
// Usage: npm run build   (exit 0 = every file parses)
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'logs', 'uploads']);
const EXTENSIONS = new Set(['.js', '.mjs']);

function collect(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collect(full, files);
    } else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

const files = collect(ROOT).sort();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({ file: relative(ROOT, file), output: (result.stderr || '').trim() });
  }
}

if (failures.length > 0) {
  console.error(`❌ Syntax check failed for ${failures.length} of ${files.length} file(s):`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.file}\n${failure.output}`);
  }
  process.exit(1);
}

console.log(`✅ Syntax check passed for ${files.length} backend file(s)`);
