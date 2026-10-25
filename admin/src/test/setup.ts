import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Without vitest `globals: true`, RTL cannot auto-register cleanup itself.
afterEach(() => {
  cleanup();
});

// Keep test output clean: react-toastify renders portals we do not assert on.
vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  ToastContainer: () => null,
}));
