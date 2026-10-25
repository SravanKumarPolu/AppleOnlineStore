// K-6 fix regression suite — admin panel 404 route + mobile navigation.
//
// Pre-fix behavior (the defect): App.tsx had no catch-all route, so an
// unknown admin URL rendered an empty content area (blank screen), and the
// only navigation (the Sidebar) is `hidden lg:block` — below the lg
// breakpoint there was NO way to navigate at all.
//
// Post-fix: "*" renders the NotFound page (with a route home), and the
// MobileNav strip renders the same eight destinations as the Sidebar.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import NotFound from '../../pages/NotFound';
import MobileNav from '../../components/MobileNav';
import Sidebar from '../../components/Sidebar';

// Sidebar destinations use full labels ("Sales Analytics"), but the
// compact mobile strip shortens the four analytics links ("Sales",
// "Products", "Users", "Search") — hrefs stay identical.
const MOBILE_LINKS: Array<[string, string]> = [
  ['Dashboard', '/dashboard'],
  ['Add Products', '/add'],
  ['Product List', '/list'],
  ['Orders', '/orders'],
  ['Sales', '/analytics/sales'],
  ['Products', '/analytics/products'],
  ['Users', '/analytics/users'],
  ['Search', '/analytics/search'],
];

// OrdersIcon embeds <title>order-history</title>, which leaks into the
// Orders link's accessible name; an end-anchored regex absorbs that
// prefix. All other links have clean names, so exact string matching
// avoids the "Add Products" vs "Products" ambiguity.
const getLink = (name: string) =>
  name === 'Orders'
    ? screen.getByRole('link', { name: new RegExp(`${name}$`) })
    : screen.getByRole('link', { name });

describe('NotFound page (admin catch-all route — K-6 fix)', () => {
  it('renders a clear 404 with a link back to the dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/some/unknown/admin/route']}>
        <Routes>
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(
      screen.getByText(/does not exist or may have been moved/i)
    ).toBeInTheDocument();

    const home = screen.getByRole('link', { name: /back to dashboard/i });
    expect(home).toHaveAttribute('href', '/dashboard');
  });

  it('is reachable via the catch-all route for an unknown path', () => {
    render(
      <MemoryRouter initialEntries={['/nonexistent']}>
        <Routes>
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    );

    // The NotFound content rendered (not the dashboard, not a blank screen).
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });
});

describe('MobileNav (admin navigation below lg — K-6 fix)', () => {
  it('renders all eight Sidebar destinations with correct hrefs', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <MobileNav />
      </MemoryRouter>
    );

    for (const [name, href] of MOBILE_LINKS) {
      const link = getLink(name);
      expect(link).toHaveAttribute('href', href);
    }

    expect(
      screen.getByRole('navigation', { name: /admin mobile navigation/i })
    ).toBeInTheDocument();
  });

  it('marks the currently open route active, exactly like the Sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/search']}>
        <MobileNav />
      </MemoryRouter>
    );

    const searchLink = getLink('Search');
    expect(searchLink.className).toContain('active');

    const dashboardLink = getLink('Dashboard');
    expect(dashboardLink.className).not.toContain('active');
  });

  it('keeps the Sidebar and MobileNav destinations in sync', () => {
    // The K-6 risk after the fix: someone adds a page to the Sidebar but
    // forgets MobileNav (or vice versa). Both components must expose the
    // same set of hrefs.
    const { unmount } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Sidebar />
      </MemoryRouter>
    );
    const sidebarHrefs = new Set(
      screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    );

    unmount();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <MobileNav />
      </MemoryRouter>
    );
    const mobileHrefs = new Set(
      screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    );

    expect([...mobileHrefs].sort()).toEqual([...sidebarHrefs].sort());
  });
});
