// Admin Sidebar contract: renders the eight navigation links (each target is
// a real <Route> in App.tsx — /dashboard, /add, /list, /orders and the four
// /analytics/* pages), and NavLink marks exactly the current route's link as
// active. As-built quirk pinned here: App routes "/" to Dashboard, but the
// Dashboard NavLink targets "/dashboard", so no sidebar item is highlighted
// on the index route.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import Sidebar from '../../components/Sidebar';

const NAV_LINKS: Array<[string, string]> = [
  ['Dashboard', '/dashboard'],
  ['Add Products', '/add'],
  ['Product List', '/list'],
  ['Orders', '/orders'],
  ['Sales Analytics', '/analytics/sales'],
  ['Product Performance', '/analytics/products'],
  ['User Behavior', '/analytics/users'],
  ['Search Analytics', '/analytics/search'],
];

const renderSidebarAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  );

// OrdersIcon renders <title>order-history</title>, which leaks into the
// link's accessible name ("order-history Orders"); end-anchored regexes
// absorb that prefix while still pinning the visible label.
const getLink = (name: string) =>
  screen.getByRole('link', { name: new RegExp(`${name}$`) });

describe('Sidebar (admin panel)', () => {
  it('renders all navigation links pointing at real App routes', () => {
    renderSidebarAt('/dashboard');

    for (const [name, href] of NAV_LINKS) {
      const link = getLink(name);
      expect(link).toHaveAttribute('href', href);
    }

    // Section headings and brand.
    expect(screen.getByText('Main Navigation')).toBeInTheDocument();
    expect(screen.getByText('Analytics & Insights')).toBeInTheDocument();
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getAllByText('System Online')).toHaveLength(2);
  });

  it('highlights the analytics route that is currently open', () => {
    renderSidebarAt('/analytics/sales');

    const salesLink = getLink('Sales Analytics');
    expect(salesLink.className).toContain('active');

    const dashboardLink = getLink('Dashboard');
    expect(dashboardLink.className).not.toContain('active');
  });

  it('highlights the orders route when it is open', () => {
    renderSidebarAt('/orders');

    const ordersLink = getLink('Orders');
    expect(ordersLink.className).toContain('active');

    const dashboardLink = getLink('Dashboard');
    expect(dashboardLink.className).not.toContain('active');
  });

  it('highlights nothing on the index route (as-built: "/" renders Dashboard but the link targets "/dashboard")', () => {
    renderSidebarAt('/');

    for (const [name] of NAV_LINKS) {
      const link = getLink(name);
      expect(link.className).not.toContain('active');
    }
  });
});
