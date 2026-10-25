import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import Layout from '../../layout/Layout';
import Hero from '../../components/Hero';
import Footer from '../../components/Footer';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// Composition smoke for the shared chrome. These do not assert styling — they
// catch the failure mode that matters (a chrome component throwing or silently
// rendering nothing, which blanks every page that uses the layout).

vi.mock('../../context/pwa-install-context', () => ({
  usePWAInstall: () => ({ isInstalled: true, openGuide: vi.fn() }),
}));

const contextValue = createMockContextValue({ isLoggedIn: true });

describe('layout and chrome', () => {
  it('wraps page content with the navigation and the footer', () => {
    renderWithProviders(
      <Layout>
        <p>Page content goes here</p>
      </Layout>,
      { contextValue }
    );

    expect(screen.getByText('Page content goes here')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(0); // NavBar
    expect(screen.getByText('Newsletter')).toBeInTheDocument(); // Footer
    // SearchBar is collection-only.
    expect(screen.queryByLabelText('Search products')).not.toBeInTheDocument();
  });

  it('renders the hero headline and badge', () => {
    renderWithProviders(<Hero />, { contextValue });

    expect(screen.getByText('Our Bestseller')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Latest\s*Arrivals/);
  });

  it('renders the footer newsletter call to action', () => {
    renderWithProviders(<Footer />, { contextValue });

    expect(screen.getByText('Newsletter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subscribe/i })).toBeInTheDocument();
  });
});
