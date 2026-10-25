import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';

// Without vitest `globals: true`, RTL cannot auto-register cleanup itself.
afterEach(() => {
  cleanup();
});

// framer-motion builds a real animation tree (waapi/microtask scheduling) that
// jsdom has to lay out synchronously. Rendering a grid of 8 `<motion.div>`
// cards that way costs several seconds of CPU and made component suites time
// out (5 s default) when the whole gate ran under load. No assertion in this
// repository depends on animation state, so animation is replaced with static
// pass-through elements: same DOM, same accessible tree, no scheduler.
//
// Only `motion` and `AnimatePresence` are imported anywhere in src/ (verified
// by scanning every import), so this mock covers the whole surface.
vi.mock('framer-motion', async () => {
  const React = await import('react');

  // Motion-only props that must never reach the DOM (React would warn).
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileDrag',
    'whileInView',
    'viewport',
    'layout',
    'layoutId',
    'layoutDependency',
    'drag',
    'dragConstraints',
    'dragElastic',
    'dragMomentum',
    'onAnimationStart',
    'onAnimationComplete',
    'onUpdate',
    'onViewportEnter',
    'onViewportLeave',
  ]);

  type DomProps = Record<string, unknown> & { children?: ReactNode };
  type MotionComponent = (props: DomProps) => ReactNode;

  const stripMotionProps = (props: DomProps): Record<string, unknown> => {
    const domProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!MOTION_PROPS.has(key) && key !== 'children') {
        domProps[key] = value;
      }
    }
    return domProps;
  };

  const componentCache = new Map<string, MotionComponent>();
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string): MotionComponent => {
        let component = componentCache.get(tag);
        if (!component) {
          component = ({ children, ...props }: DomProps) =>
            React.createElement(tag, stripMotionProps(props), children);
          (component as { displayName?: string }).displayName = `motion.${tag}`;
          componentCache.set(tag, component);
        }
        return component;
      },
    },
  );

  const AnimatePresence = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return { motion, AnimatePresence };
});

// jsdom does not implement browser APIs that animation/visibility libraries
// rely on. Mock them so components under test render without warnings.

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: (): boolean => false,
  }),
});

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = (): IntersectionObserverEntry[] => [];
}

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.IntersectionObserver = MockIntersectionObserver;
globalThis.ResizeObserver = MockResizeObserver;

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
