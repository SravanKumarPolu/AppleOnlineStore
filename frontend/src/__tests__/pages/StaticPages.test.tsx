import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import Home from '../../pages/Home';
import About from '../../pages/About';
import Contact from '../../pages/Contact';
import NotFound from '../../pages/NotFound';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

// Smoke coverage for the remaining routable storefront pages. These assert the
// page composes and renders its key content — not styling. ProductCards are
// stubbed because Home renders a full grid and the card itself is covered by
// ProductItems.test.tsx.
vi.mock('../../components/ProductItems', () => ({
  default: ({ name }: { name: string }) => <p>{name}</p>,
}));

const contextValue = createMockContextValue({
  products: [makeProduct({ _id: 'p1', name: 'Smoke Product' })],
  isLoggedIn: true,
});

describe('static and landing pages', () => {
  it('renders the home page with its sections', () => {
    renderWithProviders(<Home />, { contextValue });

    expect(screen.getByText('New Arrivals')).toBeInTheDocument();
    // 'Latest Collection' appears as a heading split across nodes.
    expect(screen.getByText((_, el) => el?.tagName === 'H2' && /Latest/.test(el.textContent ?? ''))).toBeTruthy();
    expect(screen.getAllByText('Smoke Product').length).toBeGreaterThan(0);
  });

  it('renders the about page content', () => {
    renderWithProviders(<About />, { contextValue });

    expect(screen.getByText('ABOUT')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('Quality Assurance')).toBeInTheDocument();
    expect(screen.getByText('Affordable Prices')).toBeInTheDocument();
  });

  it('renders the contact page with store details', () => {
    renderWithProviders(<Contact />, { contextValue });

    expect(screen.getByText('CONTACT')).toBeInTheDocument();
    expect(screen.getByText('Our Store')).toBeInTheDocument();
    expect(screen.getByText('Contact Details')).toBeInTheDocument();
  });

  it('renders the 404 page instead of a blank screen', () => {
    renderWithProviders(<NotFound />, { contextValue });

    expect(screen.getByRole('heading', { level: 1, name: '404' })).toBeInTheDocument();
    expect(screen.getByText(/Page not found/i)).toBeInTheDocument();
  });
});
