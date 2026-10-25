import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import LatestCollection from '../../components/LatestCollection';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

// Rendering 8 real product cards costs seconds of jsdom CPU (and ~18 s under
// coverage instrumentation), which timed out this spec. The behaviour under
// test is "slice the newest 8", not the card itself (covered by
// ProductItems.test.tsx).
vi.mock('../../components/ProductItems', () => ({
  default: ({ name }: { name: string }) => <p>{name}</p>,
}));

describe('LatestCollection (Rules of Hooks regression)', () => {
  it('renders up to 8 newest products', () => {
    const products = Array.from({ length: 10 }, (_, i) =>
      makeProduct({ _id: `p${i + 1}`, name: `New Arrival ${i + 1}` }),
    );

    renderWithProviders(<LatestCollection />, {
      contextValue: createMockContextValue({ products }),
    });

    expect(screen.getByText('New Arrival 1')).toBeInTheDocument();
    expect(screen.getByText('New Arrival 8')).toBeInTheDocument();
    // Only the first 8 products are shown.
    expect(screen.queryByText('New Arrival 9')).not.toBeInTheDocument();
    expect(screen.queryByText('New Arrival 10')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when no products exist', () => {
    renderWithProviders(<LatestCollection />, {
      contextValue: createMockContextValue({ products: [] }),
    });

    expect(screen.getByText(/No new products found/i)).toBeInTheDocument();
  });

  it('invokes refreshProducts from the context when Refresh is clicked', () => {
    const refreshProducts = vi.fn();
    renderWithProviders(<LatestCollection />, {
      contextValue: createMockContextValue({
        products: [makeProduct()],
        refreshProducts,
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Refresh Products/i }));
    expect(refreshProducts).toHaveBeenCalledTimes(1);
  });
});
