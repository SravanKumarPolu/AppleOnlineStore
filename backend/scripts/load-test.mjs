#!/usr/bin/env node
// Phase 6 — Load / performance test harness for NovaCart backend.
//
// Runs controlled load scenarios (1 → 10 → 50 → 100 → 250 concurrent virtual
// users) against a REAL backend instance (e2e-server.mjs boots the app with
// an in-memory MongoDB + seeded products). Uses Node's built-in http module —
// no new dependencies.
//
// Safety: stress levels run only if the previous level stayed healthy
// (error rate < 5%, p95 < 3000 ms). Extreme load (500) is intentionally NOT
// executed on this 2-CPU / 4 GB sandbox — documented in the report.
//
// Usage: node scripts/load-test.mjs [--max-vu 250] [--duration 15]
import http from 'node:http';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Repo-relative paths (previously hardcoded to one author's absolute
// checkout path, breaking every other machine).
const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(HERE, '..');
const REPO_ROOT = join(BACKEND_DIR, '..');
// Dedicated port: the harness must never accidentally probe a developer's
// running server (or a real database) that happens to occupy 3001.
const PORT = process.env.LOAD_TEST_PORT || '3101';
const BASE = process.env.LOAD_TEST_BASE || `http://127.0.0.1:${PORT}`;
const OUT = process.env.LOAD_TEST_OUT || join(REPO_ROOT, 'docs', 'testing', 'load-results.json');
const CHECKOUT_SCENARIO = 'POST /api/orders (checkout write)';

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? Number(args[i + 1]) : def;
};
const MAX_VU = argOf('max-vu', 250);
const DURATION = argOf('duration', 15); // seconds per level

// ---------------- helpers ----------------
function requestOnce(path, { method = 'GET', body = null, token = null } = {}) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.token = token;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      `${BASE}${path}`,
      { method, headers, timeout: 20000 },
      (res) => {
        res.resume();
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          resolve({ status: res.statusCode, ms });
        });
      }
    );
    req.on('error', () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - start) / 1e6 }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: 20000 }); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitFor(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await requestOnce(url);
      if (r.status === 200) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** POST + parse JSON (used for fixture/stock verification). */
function postJson(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${BASE}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on('error', () => resolve({}));
    req.write(payload);
    req.end();
  });
}

/**
 * A load run must only touch a disposable loopback instance. The harness boots
 * its own in-memory backend on PORT, but LOAD_TEST_BASE could point anywhere —
 * refuse anything that is not loopback unless explicitly overridden.
 */
function assertLocalTarget(base) {
  let hostname;
  try {
    hostname = new URL(base).hostname;
  } catch {
    console.error(`⛔ Invalid LOAD_TEST_BASE: ${base}`);
    process.exit(1);
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'];
  if (!loopback.includes(hostname) && !args.includes('--allow-remote')) {
    console.error(
      `⛔ Refusing to load-test ${base}: only a loopback/disposable backend is allowed.`
    );
    console.error('   Pass --allow-remote only for a dedicated non-production load target.');
    process.exit(1);
  }
  return hostname;
}

function procStats(pid) {
  // Linux containers (where Phase 01 runs): /proc gives exact CPU jiffies + RSS.
  // macOS: `ps -o time=` reports 0:00.00 even for a CPU-burning process and
  // `top -pid` output is not machine-stable, so CPU is reported as null there
  // instead of a fabricated 0 %. RSS is still measured (and was also broken
  // before: the old code returned 0 MB for every process).
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
      const utime = Number(stat[13]) + Number(stat[14]); // ticks (100/s)
      const mem = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const rss = Number((mem.match(/VmRSS:\s+(\d+) kB/) || [0, 0])[1]);
      return { cpuTicks: utime, rssKb: rss, cpuUnitPerSecond: 100 };
    }

    const out = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim();
    return { cpuTicks: null, rssKb: Number(out) || 0, cpuUnitPerSecond: 1 };
  } catch {
    return { cpuTicks: null, rssKb: 0, cpuUnitPerSecond: 1 };
  }
}

// Runs `vu` concurrent workers, each looping scenario requests for DURATION s.
// Scenario choice is WEIGHTED (a real storefront is read-heavy and does not
// hammer /health/ready): the previous round-robin gave the probe 1/8 of all
// traffic, which inflated throughput and told us nothing about checkout.
function makeScenarioPicker(scenarios) {
  const total = scenarios.reduce((sum, sc) => sum + (sc.weight ?? 1), 0);
  return () => {
    let roll = Math.random() * total;
    for (const sc of scenarios) {
      roll -= sc.weight ?? 1;
      if (roll <= 0) return sc;
    }
    return scenarios[scenarios.length - 1];
  };
}

async function runLevel(level, vu, scenarios, tokens) {
  const stop = Date.now() + DURATION * 1000;
  const results = [];
  const pick = makeScenarioPicker(scenarios);
  const workers = Array.from({ length: vu }, async () => {
    while (Date.now() < stop) {
      const sc = pick();
      const token = sc.auth === 'user' ? tokens.user : sc.auth === 'admin' ? tokens.admin : null;
      const r = await requestOnce(sc.path, {
        method: sc.method,
        body: sc.body ? { ...sc.body } : null,
        token,
      });
      results.push({ name: sc.name, status: r.status, ms: r.ms });
    }
  });
  await Promise.all(workers);

  const wall = DURATION;
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => r.status === 0 || r.status >= 500).length;
  const perScenario = {};
  for (const name of new Set(results.map((r) => r.name))) {
    const rs = results.filter((r) => r.name === name);
    const lats = rs.map((r) => r.ms).sort((a, b) => a - b);
    perScenario[name] = {
      count: rs.length,
      success: rs.filter((r) => r.status >= 200 && r.status < 300).length,
      success_rate: +((rs.filter((r) => r.status >= 200 && r.status < 300).length / rs.length) * 100).toFixed(2),
      client_errors: rs.filter((r) => r.status >= 400 && r.status < 500).length,
      rps: +(rs.length / wall).toFixed(1),
      avg_ms: +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1),
      p50_ms: +percentile(lats, 50).toFixed(1),
      p95_ms: +percentile(lats, 95).toFixed(1),
      p99_ms: +percentile(lats, 99).toFixed(1),
      max_ms: +lats[lats.length - 1].toFixed(1),
      errors: rs.filter((r) => r.status === 0 || r.status >= 500).length,
    };
  }
  return {
    level,
    vu,
    duration_s: wall,
    total_requests: results.length,
    throughput_rps: +(results.length / wall).toFixed(1),
    error_rate: +((errors / Math.max(1, results.length)) * 100).toFixed(2),
    // 4xx are not server faults, but they must be visible: an exhausted stock
    // or a rejected checkout shows up here, never as silent success.
    client_error_rate: +(
      (results.filter((r) => r.status >= 400 && r.status < 500).length /
        Math.max(1, results.length)) *
      100
    ).toFixed(2),
    latency: {
      avg_ms: +(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)).toFixed(1),
      p50_ms: +percentile(latencies, 50).toFixed(1),
      p95_ms: +percentile(latencies, 95).toFixed(1),
      p99_ms: +percentile(latencies, 99).toFixed(1),
    },
    scenarios: perScenario,
  };
}

// ---------------- main ----------------
async function main() {
  console.log('=== NovaCart Load Test Harness ===');
  assertLocalTarget(BASE);
  console.log(`Target: ${BASE} (disposable in-memory backend)`);
  // Levels actually executed (dedup + cap), printed from the same array the
  // loop uses so the banner can never advertise a level that is not run.
  const LEVELS = [1, 10, 50, 100, MAX_VU].filter((v, i, a) => a.indexOf(v) === i && v <= MAX_VU);
  console.log(`Levels: ${LEVELS.join(', ')} VUs | ${DURATION}s each | stop-if: err>5% or p95>3000ms`);

  // 1. Boot the backend (in-memory Mongo + seeds + real server.js).
  console.log('\n[1/4] Booting backend via e2e-server.mjs ...');
  const server = spawn('node', ['scripts/e2e-server.mjs'], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Dedicated port + deep stock: without E2E_STOCK the seeded catalog has 10
    // units per product and the 10% checkout-write mix exhausts it in seconds,
    // turning most writes into 400s (which the error rate ignores). The mix
    // must measure serving capacity, not inventory exhaustion.
    env: {
      ...process.env,
      E2E_PORT: PORT,
      E2E_STOCK: process.env.E2E_STOCK || '1000000',
      // The per-IP limiter (1000/15min) would otherwise turn almost every
      // request into a 429 within the first second and the run would measure
      // the limiter, not the app. Raised ONLY on this disposable instance.
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX || '100000000',
    },
  });
  let serverLogs = '';
  server.stdout.on('data', (d) => (serverLogs += d));
  server.stderr.on('data', (d) => (serverLogs += d));

  const ready = await waitFor('/health/ready', 90000);
  if (!ready) {
    console.error('Backend failed to become ready:\n', serverLogs.slice(-2000));
    server.kill('SIGKILL');
    process.exit(1);
  }
  // Resolve the PID of the server this harness just spawned — NOT the first
  // `node server.js` on the machine. `pgrep -f` previously matched whatever
  // dev server was already running, so RSS/CPU were sampled from the wrong
  // process (and a developer's own server appeared in the results). e2e-server
  // spawns exactly one child: the real server.js.
  const resolveServerPid = () => {
    try {
      const child = execSync(`pgrep -P ${server.pid}`).toString().trim().split('\n')[0];
      return child || String(server.pid);
    } catch {
      return String(server.pid);
    }
  };
  const serverPid = resolveServerPid();
  console.log(`Backend ready (pid ${serverPid}).`);

  // 2. Prepare tokens + product id from the seed.
  const adminLogin = await requestOnce('/api/user/admin', {
    method: 'POST',
    body: { email: 'e2e-admin@example.com', password: 'e2e-admin-password-1' },
  });
  // Re-do with response body capture (need the token text):
  const adminToken = await new Promise((resolve) => {
    const payload = JSON.stringify({ email: 'e2e-admin@example.com', password: 'e2e-admin-password-1' });
    const req = http.request(`${BASE}/api/user/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data).token); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });

  // Register a shopper for authenticated scenarios.
  const userEmail = `load-${Date.now()}@example.com`;
  const register = await new Promise((resolve) => {
    const payload = JSON.stringify({ name: 'Load Tester', email: userEmail, password: 'Load!Test123' });
    const req = http.request(`${BASE}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.write(payload);
    req.end();
  });

  // Find a seeded product id via the public listing.
  const listBody = await new Promise((resolve) => {
    http.get(`${BASE}/api/product/list?limit=10`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    }).on('error', () => resolve({}));
  });
  const product = (listBody.products || [])[0];
  if (!product || !adminToken || !register.token) {
    console.error('Fixture preparation failed:', { product: !!product, adminToken: !!adminToken, register: !!register.token });
    server.kill('SIGKILL');
    process.exit(1);
  }
  const tokens = { user: register.token, admin: adminToken };
  console.log('[2/4] Fixtures ready (shopper token, admin token, product).');

  // Baseline for the post-load stock-consistency assertion.
  const initialProduct = await postJson('/api/product/single', {
    productId: String(product._id),
  });
  const initialStock = initialProduct?.product?.stockQuantity ?? null;

  // 3. Scenario mix — weights approximate a real storefront session: mostly
  //    catalog reads, some authenticated reads, and a real checkout write
  //    (order creation + atomic stock reservation + user history + analytics).
  //    The health probe keeps a token share only (it is a probe, not traffic).
  const loadAddress = {
    firstName: 'Load',
    lastName: 'Tester',
    email: 'load@example.com',
    street: '1 Load Street',
    city: 'Springfield',
    state: 'IL',
    zipcode: '62701',
    country: 'USA',
    phone: '5550100',
  };

  const scenarios = [
    { name: 'GET /health/ready', path: '/health/ready', weight: 0.02 },
    { name: 'GET /api/product/list', path: '/api/product/list?page=1&limit=12', weight: 0.25 },
    { name: 'GET /api/product/list?search', path: '/api/product/list?page=1&limit=12&search=iPhone', weight: 0.10 },
    { name: 'POST /api/product/single', path: '/api/product/single', method: 'POST', body: { productId: String(product._id) }, weight: 0.20 },
    { name: 'GET /api/category/list', path: '/api/category/list', weight: 0.05 },
    { name: 'POST /api/orders/userorders (auth)', path: '/api/orders/userorders', method: 'POST', body: {}, auth: 'user', weight: 0.10 },
    { name: 'POST /api/cart/get (auth)', path: '/api/cart/get', method: 'POST', body: {}, auth: 'user', weight: 0.13 },
    { name: 'GET /api/orders/all (admin)', path: '/api/orders/all', auth: 'admin', weight: 0.05 },
    {
      name: 'POST /api/orders (checkout write)',
      path: '/api/orders',
      method: 'POST',
      body: {
        items: [{ productId: String(product._id), quantity: 1, color: 'Black' }],
        address: loadAddress,
        paymentMethod: 'COD',
      },
      auth: 'user',
      weight: 0.10,
    },
  ];

  // 4. Run levels with escalation guard + resource sampling.
  console.log('[3/4] Running load levels ...');
  const levelsOut = [];
  const resourceSamples = [];
  let checkoutSuccesses = 0;
  let checkoutAttempts = 0;
  for (const vu of LEVELS) {
    const before = procStats(serverPid);
    const t0 = Date.now();
    const res = await runLevel(`VU=${vu}`, vu, scenarios, tokens);
    const after = procStats(serverPid);
    const elapsedS = Math.max(0.001, (Date.now() - t0) / 1000);
    const measurableCpu =
      before.cpuTicks !== null && after.cpuTicks !== null && before.cpuTicks !== undefined && after.cpuTicks !== undefined;
    const cpuSeconds = measurableCpu ? (after.cpuTicks - before.cpuTicks) / (after.cpuUnitPerSecond || 1) : null;
    const cpuPct = measurableCpu ? +((cpuSeconds / elapsedS) * 100).toFixed(1) : null; // % of ONE core
    Object.assign(res, {
      server_cpu_pct_one_core: cpuPct,
      server_rss_mb: +(after.rssKb / 1024).toFixed(1),
    });
    resourceSamples.push({ vu, rss_mb: res.server_rss_mb, cpu_pct: cpuPct });
    levelsOut.push(res);
    const checkout = res.scenarios[CHECKOUT_SCENARIO];
    checkoutSuccesses += checkout?.success || 0;
    checkoutAttempts += checkout?.count || 0;
    console.log(
      `  VU=${String(vu).padStart(3)} → ${res.total_requests} req | ${res.throughput_rps} rps | ` +
      `avg ${res.latency.avg_ms}ms | p50 ${res.latency.p50_ms} | p95 ${res.latency.p95_ms} | ` +
      `p99 ${res.latency.p99_ms} | err ${res.error_rate}% | 4xx ${res.client_error_rate}% | ` +
      `rss ${res.server_rss_mb}MB | cpu ${cpuPct === null ? 'n/a (non-Linux host)' : `${cpuPct}%`}`
    );

    // Escalation guard.
    if (res.error_rate > 5) { console.log('  ⛔ stopping: error rate > 5%'); break; }
    if (res.latency.p95_ms > 3000) { console.log('  ⛔ stopping: p95 > 3000ms'); break; }
    if (res.server_rss_mb > 2500) { console.log('  ⛔ stopping: RSS > 2.5GB safety limit'); break; }
    await new Promise((r) => setTimeout(r, 3000)); // cool-down between levels
  }

  // 5. Recovery check: after peak load, does the server still respond fast?
  console.log('[4/4] Post-load recovery check ...');
  await new Promise((r) => setTimeout(r, 3000));
  const recovery = [];
  for (let i = 0; i < 5; i++) recovery.push(await requestOnce('/health/ready'));
  const recoveryAvg = +(recovery.reduce((a, b) => a + b.ms, 0) / recovery.length).toFixed(1);
  const recoveryOk = recovery.every((r) => r.status === 200);
  console.log(`  Recovery: /health/ready avg ${recoveryAvg}ms, all-200=${recoveryOk}`);

  // Stock consistency: every successful checkout decrements exactly one unit
  // of the product under load. Any drift means a lost update or a double
  // reservation that the level metrics would not show.
  const finalProduct = await postJson('/api/product/single', {
    productId: String(product._id),
  });
  const finalStock = finalProduct?.product?.stockQuantity ?? null;
  const expectedFinal = initialStock === null ? null : initialStock - checkoutSuccesses;
  const stockConsistent = expectedFinal === null ? null : finalStock === expectedFinal;

  server.kill('SIGTERM');
  const summary = {
    generated_at: new Date().toISOString(),
    // Measured, not claimed: the previous string was a hardcoded "2 vCPU /
    // 4 GB sandbox" that travelled into every result file regardless of host.
    environment: `${os.platform()} ${os.arch()} — ${os.cpus().length} vCPU, ${(
      os.totalmem() /
      1024 ** 3
    ).toFixed(1)} GB RAM, Node ${process.version}, in-memory MongoDB`,
    scenario_mix: scenarios.map((sc) => ({ name: sc.name, weight: sc.weight ?? 1 })),
    checkout: {
      attempts: checkoutAttempts,
      successful_orders: checkoutSuccesses,
      success_rate: checkoutAttempts ? +((checkoutSuccesses / checkoutAttempts) * 100).toFixed(2) : null,
    },
    stock_consistency: {
      initial_stock: initialStock,
      final_stock: finalStock,
      expected_final: expectedFinal,
      consistent: stockConsistent,
    },
    load_notes: [
      'POST /api/orders exercises the real checkout write path (server-side pricing, atomic stock reservation, user history, analytics).',
      'PayPal network calls are NOT part of the mix: capture/webhook latency is dominated by the external provider. The app-side work per payment is what this mix measures.',
    ],
    resource_sampling: 'RSS is sampled from /proc (Linux) or ps (macOS); CPU is null on non-Linux hosts, never reported as 0',
    duration_per_level_s: DURATION,
    levels: levelsOut,
    recovery: { health_ready_avg_ms: recoveryAvg, all_200: recoveryOk },
    notes: [
      'Extreme load (500 VU) intentionally NOT executed: sandbox has 2 vCPU/4GB shared with the test harness itself.',
      'Write-heavy order placement runs against a fixture product seeded with E2E_STOCK units (1,000,000 by default) so the mix measures serving capacity, not inventory exhaustion.',
      'Per-scenario 4xx counts and success rates are reported: an exhausted stock or rejected checkout can never look like success.',
      'CPU percent is relative to ONE core (200% = both cores saturated).',
    ],
  };
  // Write the artifact: create the PARENT directory only. The previous
  // `OUT.replace('/load-results.json','')` mkdir'ed the output path itself for
  // any non-default LOAD_TEST_OUT, which then failed writeFileSync with EISDIR.
  fs.mkdirSync(dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`\nResults written to ${OUT}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
