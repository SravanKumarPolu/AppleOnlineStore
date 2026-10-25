import { defineConfig } from '@playwright/test';

// Real-browser E2E for the storefront checkout money path (testing-plan gap
// §5.1). Two servers are orchestrated per run:
//   1. the REAL backend (node server.js) against an in-memory MongoDB, via
//      backend/scripts/e2e-server.mjs — ready when /health/ready answers 200
//   2. the storefront vite dev server on 5173 (default CORS-allowed origin)
//
// Run with:  npm run test:e2e      (from frontend/)
// NOTE: the PayPal branch needs real sandbox credentials and a public HTTPS
// host (docs/devops/08) — only COD/Card + auth wiring run here.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      cwd: '../backend',
      url: 'http://localhost:3001/health/ready',
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
