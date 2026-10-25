export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  // Runs in every worker BEFORE test module imports — guarantees required env
  // vars exist at app.js import time (JWT/PayPal placeholders, test-only).
  setupFiles: ['<rootDir>/__tests__/env-setup.mjs'],
  testMatch: ['**/*.spec.js'],
  testTimeout: 30000,
  verbose: true,
};
