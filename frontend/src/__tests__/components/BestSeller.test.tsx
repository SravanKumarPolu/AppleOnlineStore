import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BestSeller from '../../components/BestSeller';
import { ShopContext } from '../../context/shop-context';
import type { ShopContextType } from '../../types';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

describe('BestSeller (Rules of Hooks regression)', () => {
  it('renders bestseller products from the catalog', () => {
    const products = [
      makeProduct({ _id: 'p1', name: 'Best Seller One', bestseller: true }),
      makeProduct({ _id: 'p2', name: 'Best Seller Two', bestseller: true }),
      makeProduct({ _id: 'p3', name: 'Regular Product', bestseller: false }),
    ];

    renderWithProviders(<BestSeller />, {
      contextValue: createMockContextValue({ products }),
    });

    expect(screen.getByText('Best Seller One')).toBeInTheDocument();
    expect(screen.getByText('Best Seller Two')).toBeInTheDocument();
    // Non-bestseller products must be filtered out of the carousel.
    expect(screen.queryByText('Regular Product')).not.toBeInTheDocument();
  });

  // 20s budget: the animated carousel outlives the 5s default when every line
  // runs under coverage instrumentation (plain runs finish in ~2s).
  it('paginates the carousel across slides (4 items per slide)', async () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      makeProduct({ _id: `p${i + 1}`, name: `BestSeller Item ${i + 1}`, bestseller: true }),
    );

    renderWithProviders(<BestSeller />, {
      contextValue: createMockContextValue({ products }),
    });

    // Slide 1: first four items visible, fifth hidden.
    expect(screen.getByText('BestSeller Item 1')).toBeInTheDocument();
    expect(screen.getByText('BestSeller Item 4')).toBeInTheDocument();
    expect(screen.queryByText('BestSeller Item 5')).not.toBeInTheDocument();

    // Navigate to slide 2 via the next button. AnimatePresence (mode="wait")
    // keeps the old slide mounted until its exit animation finishes, so the
    // incoming item is awaited rather than asserted synchronously.
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));

    // AnimatePresence exit transitions can take longer when coverage
    // instrumentation slows the environment — allow a wider poll window.
    expect(
      await screen.findByText('BestSeller Item 5', undefined, { timeout: 3000 })
    ).toBeInTheDocument();
    // Slide counter reflects the active slide (0-indexed internally).
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  }, 20000);

  it('shows the loading placeholder when the catalog is empty', () => {
    renderWithProviders(<BestSeller />, {
      contextValue: createMockContextValue({ products: [] }),
    });

    expect(screen.getByText(/Loading best sellers/i)).toBeInTheDocument();
  });

  it('renders nothing (without crashing) when the context is missing', () => {
    // No ShopContext.Provider mounted: the component must bail out cleanly
    // AFTER its hooks have run (Rules of Hooks).
    const { container } = render(
      <MemoryRouter>
        <BestSeller />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('recovers when bestsellers load after mount (hooks run unconditionally)', () => {
    // Guards the reordering fix: with the old code the early return on empty
    // products skipped the hooks, so a later render with products crashed with
    // "Rendered more hooks than during the previous render".
    let contextValue: ShopContextType = createMockContextValue({ products: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/']}>
        <ShopContext.Provider value={contextValue}>{children}</ShopContext.Provider>
      </MemoryRouter>
    );

    const { rerender } = render(<BestSeller />, { wrapper });
    expect(screen.getByText(/Loading best sellers/i)).toBeInTheDocument();

    contextValue = createMockContextValue({
      products: [makeProduct({ _id: 'late-1', name: 'Late Bestseller', bestseller: true })],
    });
    expect(() => rerender(<BestSeller />)).not.toThrow();
    expect(screen.getByText('Late Bestseller')).toBeInTheDocument();
    expect(screen.queryByText(/Loading best sellers/i)).not.toBeInTheDocument();
  });
});
