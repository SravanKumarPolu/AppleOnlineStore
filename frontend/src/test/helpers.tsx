import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderOptions } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import { ShopContext } from '../context/shop-context';
import type { Product, ShopContextType } from '../types';

/**
 * Builds a fully-typed ShopContext value for tests. Every function is a
 * vi.fn() so tests can assert calls and override just what they need.
 */
export const createMockContextValue = (
  overrides: Partial<ShopContextType> = {},
): ShopContextType => {
  const base: ShopContextType = {
    products: [],
    currency: '$',
    delivery_fee: 10,
    search: '',
    setSearch: vi.fn(),
    showSearch: false,
    setShowSearch: vi.fn(),
    cartItems: {},
    addToCart: vi.fn(),
    getCartCount: vi.fn(() => 0),
    updateQuantity: vi.fn(),
    getCartAmount: vi.fn(() => 0),
    navigate: vi.fn(),
    refreshProducts: vi.fn(),
    forceRefreshProducts: vi.fn(async () => undefined),
    fetchProductsWithPagination: vi.fn(async () => null),
    isLoading: false,
    isInitializing: false,
    pagination: null,

    // Authentication related
    token: '',
    setToken: vi.fn(),
    isLoggedIn: false,
    user: null,
    setUser: vi.fn(),
    loginUser: vi.fn(async () => false),
    registerUser: vi.fn(async () => false),
    logoutUser: vi.fn(),

    // Cart related
    setCartItems: vi.fn(),
    loadCartFromDatabase: vi.fn(async () => undefined),
    syncCartOnAuth: vi.fn(async () => undefined),
    loadAndSyncCart: vi.fn(async () => false),

    // WebSocket related
    webSocket: {
      isConnected: false,
      connectionError: null,
      authError: null,
      connect: vi.fn(() => null),
      disconnect: vi.fn(),
      reconnect: vi.fn(() => null),
      joinOrderRoom: vi.fn(),
      leaveOrderRoom: vi.fn(),
      sendTyping: vi.fn(),
      sendStopTyping: vi.fn(),
      socket: null,
    },
  };

  return { ...base, ...overrides };
};

/** Renders UI wrapped in MemoryRouter + ShopContext.Provider. */
export const renderWithProviders = (
  ui: ReactElement,
  options: {
    contextValue?: ShopContextType | null;
    route?: string;
    renderOptions?: Omit<RenderOptions, 'wrapper'>;
  } = {},
): RenderResult => {
  const contextValue =
    options.contextValue === undefined ? createMockContextValue() : options.contextValue;
  const route = options.route ?? '/';

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      <ShopContext.Provider value={contextValue}>{children}</ShopContext.Provider>
    </MemoryRouter>
  );

  return render(ui, { wrapper, ...options.renderOptions });
};

/** Deterministic product fixtures. */
export const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  _id: 'product-1',
  name: 'Test Product',
  description: 'A product used in tests',
  price: 100,
  image: ['/images/test-product.jpg'],
  category: 'iPhone',
  subCategory: 'Pro',
  color: ['Black', 'Silver'],
  date: 1719800000000,
  bestseller: false,
  inStock: true,
  stockQuantity: 5,
  ratings: { average: 4.5, count: 10 },
  featured: false,
  createdAt: '2024-07-01T00:00:00.000Z',
  updatedAt: '2024-07-01T00:00:00.000Z',
  ...overrides,
});
