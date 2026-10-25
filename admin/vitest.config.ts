import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dedicated Vitest config (kept separate from vite.config.ts so the Tailwind
// and SVGR plugins never run during tests). Ported from the storefront's
// setup (frontend/vitest.config.ts) when the admin test infrastructure was
// added — see docs/07-TESTING_PLAN.md §3.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
