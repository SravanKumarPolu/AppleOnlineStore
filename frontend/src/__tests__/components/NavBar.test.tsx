import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import NavBar from '../../components/NavBar';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// NavBar is the only navigation chrome on the storefront and was untested:
// link targets, the cart badge, the search toggle and the authenticated menu
// (including logout) are all user-visible contracts.

const openGuide = vi.fn();
vi.mock('../../context/pwa-install-context', () => ({
  usePWAInstall: () => ({ isInstalled: true, openGuide }),
}));

describe('NavBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderNav = (overrides = {}, route = '/') =>
    renderWithProviders(<NavBar />, {
      contextValue: createMockContextValue({ isLoggedIn: false, ...overrides }),
      route,
    });

  it('renders the four primary tabs with their routes', () => {
    renderNav();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Home',
      'Collection',
      'About',
      'Contact',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/',
      '/collection',
      '/about',
      '/contact',
    ]);
  });

  it('renders the cart badge only when the cart has items', () => {
    const { unmount } = renderNav({ getCartCount: () => 3 });
    expect(screen.getByLabelText('Cart')).toHaveTextContent('3');
    unmount();

    renderNav({ getCartCount: () => 0 });
    // The badge span is conditional; the icon must still be a link to /cart.
    expect(screen.getByLabelText('Cart')).toHaveAttribute('href', '/cart');
    expect(screen.getByLabelText('Cart')).toHaveTextContent('');
  });

  it('offers the search toggle only on the collection page', () => {
    const setShowSearch = vi.fn();
    const { unmount } = renderNav({ setShowSearch }, '/');
    expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();
    unmount();

    renderNav({ setShowSearch }, '/collection');
    fireEvent.click(screen.getByLabelText('Search'));
    expect(setShowSearch).toHaveBeenCalledWith(true);
  });

  it('sends anonymous shoppers to the login page', () => {
    renderNav({ isLoggedIn: false });

    const login = screen.getByLabelText('Login');
    expect(login.closest('a')).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('Profile')).not.toBeInTheDocument();
  });

  it('exposes profile, orders and logout in the authenticated menu', () => {
    const logoutUser = vi.fn();
    renderNav({ isLoggedIn: true, logoutUser });

    fireEvent.click(screen.getByLabelText('Profile'));

    expect(screen.getByRole('link', { name: 'My Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders');

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(logoutUser).toHaveBeenCalledTimes(1);
  });
});
