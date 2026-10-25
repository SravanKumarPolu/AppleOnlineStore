import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dedicated Vitest config (kept separate from vite.config.ts so the PWA
// plugin and its service-worker generation never run during tests).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // jsdom layout is synchronous and single-threaded, so a component that
    // renders a full product grid (8 cards, ~3 s of CPU) can exceed the 5 s
    // default whenever the machine is busy — e.g. while this suite runs next
    // to the backend/admin gates, or on a 2-vCPU CI runner. The failure was
    // real and reproduced in this audit (LatestCollection). 15 s keeps genuine
    // hangs failing while making the result independent of machine load; it is
    // a timeout budget, not a weakened assertion.
    testTimeout: 15000,
    hookTimeout: 15000,
    css: false,
    coverage: {
      // Measure application source only — exclude build artifacts (dev-dist),
      // config files, and test scaffolding from the percentages.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**', 'src/test/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
