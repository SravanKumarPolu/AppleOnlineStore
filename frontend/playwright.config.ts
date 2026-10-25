import { defineConfig } from '@playwright/test';

// Real-browser E2E for the storefront checkout money path (testing-plan gap
// §5.1). Two servers are orchestrated per run:
//   1. the REAL backend (node server.js) against an in-memory MongoDB, via
//      backend/scripts/e2e-server.mjs — ready when /health/ready answers 200
//   2. the storefront vite dev server (default CORS-allowed origin 5173)
//
// Run with:  npm run test:e2e      (from frontend/)
//
// Ports are configurable so the suite can coexist with an already-running dev
// stack (or run in parallel on CI) without touching those processes:
//   E2E_PORT=3101 E2E_WEB_PORT=5273 npm run test:e2e
//
// NOTE: the PayPal branch needs real sandbox credentials and a public HTTPS
// host (docs/devops/08) — only COD/Card + auth wiring run here.
const API_PORT = Number(process.env.E2E_PORT || 3001);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5173);
const apiUrl = `http://localhost:${API_PORT}`;
const webUrl = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: webUrl,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      cwd: '../backend',
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        E2E_PORT: String(API_PORT),
        // The storefront origin must be CORS-allowed by the E2E backend.
        FRONTEND_URL: webUrl,
      },
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        VITE_BACKEND_URL: apiUrl,
      },
    },
  ],
});
