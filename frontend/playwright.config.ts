import { defineConfig, devices } from '@playwright/test';

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
// A third server (the admin dashboard, default :5174) backs the realtime spec:
// the operator logs in there in a SEPARATE browser context while the shopper
// keeps the storefront open.
//   E2E_ADMIN_PORT=5274
//
// NOTE: the PayPal branch needs real sandbox credentials and a public HTTPS
// host (docs/devops/08) — only COD/Card + auth wiring run here.
const API_PORT = Number(process.env.E2E_PORT || 3001);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5173);
const ADMIN_WEB_PORT = Number(process.env.E2E_ADMIN_PORT || 5174);
const apiUrl = `http://localhost:${API_PORT}`;
const webUrl = `http://localhost:${WEB_PORT}`;
const adminUrl = `http://localhost:${ADMIN_WEB_PORT}`;

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
  // Cross-browser matrix. The money path must work on the three engines a
  // shopper can realistically use, not just Chromium:
  //   npm run test:e2e                      -> all three projects
  //   npm run test:e2e -- --project=chromium -> fast local loop
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
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
        // The admin dashboard origin must be allowed too: the realtime spec
        // drives a real operator session from a second browser context.
        ADMIN_URL: adminUrl,
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
    {
      // Admin dashboard (operator half of the realtime acceptance flow).
      command: `npm run dev -- --port ${ADMIN_WEB_PORT} --strictPort`,
      cwd: '../admin',
      url: adminUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        VITE_BACKEND_URL: apiUrl,
      },
    },
  ],
});
