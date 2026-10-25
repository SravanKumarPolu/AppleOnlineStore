# PERFORMANCE_TEST_REPORT — NovaCart Load & Performance Validation

**Date:** 2026-10-25 · **Harness:** `backend/scripts/load-test.mjs` (Node built-in `http`, zero new dependencies) — executed fresh this session; results persisted to `docs/testing/load-results.json`.
**Environment (must be read before quoting numbers):** isolated sandbox, **2 vCPU / 4 GB RAM, shared between the server-under-test and the load harness itself**, Node v24.21.0, in-memory MongoDB 7.0.14, **loopback networking** (no network latency). Absolute figures are sandbox-relative — they bound *this* environment and demonstrate scaling behavior, not production capacity predictions.

---

## 1. Methodology

- **Real server:** the harness boots the actual production entrypoint (`node server.js` via `e2e-server.mjs`) against a seeded in-memory MongoDB, waits for `/health/ready` = 200, creates a shopper token + admin token + product fixture, then drives HTTP traffic.
- **Escalating levels:** 1 → 10 → 50 → 100 → 250 concurrent virtual users, 15 s per level.
- **Traffic mix:** storefront-shaped reads + authenticated calls (`GET /health/ready`, `GET /api/product/list`, authed product/cart reads). Write-heavy order placement is deliberately excluded — seeded stock would exhaust and measure inventory limits, not serving capacity (documented in the harness notes).
- **Safety valve:** a level aborts the escalation if error rate > 5 % or p95 > 3000 ms.
- **Measurements per level:** total requests, throughput (rps), avg/p50/p95/p99 latency (ms), error rate, server RSS (MB), server CPU % relative to one core (200 % = both cores saturated).
- **Post-load recovery check:** `/health/ready` polled after the top level.

## 2. Results (executed 2026-10-25, final gate)

| Level | Requests | Throughput | p50 | p95 | p99 | Errors | Server RSS | CPU (1 core = 100 %) |
|---|---|---|---|---|---|---|---|---|
| 1 VU | 96,952 | 6,463 rps | 0.1 ms | 0.2 ms | 0.4 ms | **0 %** | 288 MB | 46 % |
| 10 VU | 178,668 | 11,911 rps | 0.4 ms | 1.3 ms | 14.1 ms | **0 %** | 310 MB | 76 % |
| 50 VU | 208,916 | 13,928 rps | 2.4 ms | 5.8 ms | 29.6 ms | **0 %** | 328 MB | 74 % |
| 100 VU | 194,027 | 12,935 rps | 5.2 ms | 30.9 ms | 35.3 ms | **0 %** | 333 MB | 76 % |
| 250 VU | 212,750 | 14,183 rps | 12.9 ms | **40.7 ms** | 52.5 ms | **0 %** | 348 MB | 76 % |

**Post-load recovery:** `/health/ready` avg **0.5 ms**, all responses 200 — no degradation, no warm restart, no memory-leak signature within the test window (RSS grew 288 → 348 MB across the full escalation, then stabilized).

**Total: 891,313 requests, 0 errors, across five levels.**

## 3. Reading the numbers

- **Zero errors at every level**, including 250 concurrent VUs — the drain/readiness machinery, DB pool, and event loop hold up under sustained concurrency on very modest hardware.
- **p95 stays under 41 ms at 250 VU** on a shared 2-core sandbox; p99 under 53 ms. For loopback traffic this is dominated by Node event-loop scheduling, not I/O.
- **Throughput saturates around ~13–14k rps** once both cores reach ~75 % — CPU-bound, as expected for a single Node process. Horizontal scaling (more replicas behind a load balancer) is the standard production answer; no per-request pathology (lock contention, connection storms, GC pauses visible at p99) was observed.
- **Concurrency invariants were separately proven under load** in `concurrencyRaceConditions` (2/10/50/100 in-flight *order/webhook* operations) — the performance harness here measures serving capacity; the money-path races are covered by that suite, not this one.

## 4. Frontend build performance (production bundles, built this session)

| App | Build | Size | Notes |
|---|---|---|---|
| storefront | `tsc -b && vite build` | PWA precache 103 entries / 12.5 MB total (lazy-loaded routes) | ✅ 4.12 s build |
| admin | `tsc -b && vite build` | 418.4 kB JS (119.6 kB gzip) + 116.1 kB CSS (19.3 kB gzip) | ✅ 1.94 s build |

Code-splitting is active on the storefront (per-route chunks); the admin panel ships a single-bundle SPA of moderate size. No bundle-size regressions were introduced by this engagement's fixes (no runtime code added — only dependency version/reclassification changes).

## 5. Deliberate exclusions & limitations (honest list)

1. **500 VU extreme load: NOT RUN (intentional).** The sandbox's 2 vCPU / 4 GB is shared with the harness itself; 500 VU would measure sandbox starvation, not the application. The harness caps at 250 by default and documents this.
2. **Write-heavy order-placement load: excluded from the mix** (stock-exhaustion rationale, §1). Order-path *correctness* under 100-way concurrency is separately proven (AGGRESSIVE_TEST_REPORT §2); its *throughput* under sustained write load remains unmeasured.
3. **Loopback networking** — no real network latency/bandwidth; production latency will be higher and throughput lower.
4. **Single process, no replicas** — production topology (nginx frontend container, per `frontend/nginx.conf`; MongoDB Atlas, per deployment docs) was not benchmarked.
5. **No soak test** (multi-hour memory-drift observation); the 5-level escalation (~75 s of load) cannot substitute for one.
6. **k6/Artillery/Lighthouse: NOT RUN** — the engagement evaluated existing tooling first: no k6/Artillery binaries exist in the sandbox and installing them adds nothing the built-in harness cannot measure for this topology; Lighthouse was superseded by the Playwright UI-audit specs (console errors, failed requests, mobile viewport, a11y structure) which run against the real app. Documented rather than silently skipped.
