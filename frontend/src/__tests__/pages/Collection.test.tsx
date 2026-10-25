import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import Collection from '../../pages/Collection';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

// Catalog browsing is a core shopper journey (PRD: browse / search / filter /
// sort). These specs lock two defects found in this audit:
//   1. "Sort by: Low to High" sorted only the visible page, so the cheapest
//      product of the catalog could be unreachable from page 1.
//   2. Applying a filter while on a later page kept that page number, leaving
//      an empty grid ("Showing 0 of N products") instead of clamping.

const categories = [
  { _id: 'cat-1', name: 'iPhone', isActive: true, sortOrder: 1, subCategories: [] },
  { _id: 'cat-2', name: 'Mac', isActive: true, sortOrder: 2, subCategories: [] },
];

vi.mock('../../hooks/useCategories', () => ({
  default: () => ({ categories, loading: false, error: null }),
}));

// ProductItems is a full product card (image, link, badges). Rendering 12 of
// them in jsdom costs ~0.5 s each, which made these page-logic specs time out.
// The unit under test is Collection's filter/sort/paginate pipeline, so the
// card is reduced to the two fields the assertions read.
vi.mock('../../components/ProductItems', () => ({
  default: ({ name, price }: { name: string; price: number }) => (
    <div>
      <p>{name}</p>
      <span>{price}</span>
    </div>
  ),
}));

// 14 products → 12 per page. Prices descend with the name index, so the
// cheapest product (P14) is on page 2 in the unsorted ("relevant") order.
const makeCatalog = () =>
  Array.from({ length: 14 }, (_, index) => {
    const n = index + 1;
    return makeProduct({
      _id: `p${n}`,
      name: `P${n}`,
      price: 15 - n,
      category: n === 14 ? 'Mac' : 'iPhone',
    });
  });

describe('Collection page — browse, filter, sort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // handlePageChange scrolls to top; jsdom does not implement scrollTo.
    vi.stubGlobal('scrollTo', vi.fn());
  });

  const renderCollection = (overrides = {}) =>
    renderWithProviders(<Collection />, {
      contextValue: createMockContextValue({ products: makeCatalog(), ...overrides }),
    });

  it('paginates the catalog 12 products per page', () => {
    renderCollection();

    expect(screen.getByText(/Showing 12 of 14 products/i)).toBeInTheDocument();
    expect(screen.getByText('P12')).toBeInTheDocument();
    expect(screen.queryByText('P13')).not.toBeInTheDocument();
  });

  it('sorts low-to-high across the whole catalog, not just the visible page', () => {
    renderCollection();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'low-high' } });

    // P14 costs 1 — the global minimum, previously stranded on page 2.
    const productNames = screen.getAllByText(/^P\d+$/).map((node) => node.textContent);
    expect(productNames[0]).toBe('P14');
    expect(productNames).toContain('P14');
    // The most expensive product now belongs to page 2.
    expect(screen.queryByText('P1')).not.toBeInTheDocument();
  });

  it('sorts high-to-low across the whole catalog', () => {
    renderCollection();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high-low' } });

    const productNames = screen.getAllByText(/^P\d+$/).map((node) => node.textContent);
    expect(productNames[0]).toBe('P1'); // price 14
    expect(productNames).toContain('P1');
  });

  it('clamps to the last page when a filter shrinks the result set', () => {
    renderCollection();

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('P13')).toBeInTheDocument();

    // 'Mac' matches exactly one product (P14), i.e. a single page.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mac' }));

    expect(screen.getByText(/Showing 1 of 1 products/i)).toBeInTheDocument();
    expect(screen.getByText('P14')).toBeInTheDocument();
    expect(screen.queryByText(/Showing 0 of/i)).not.toBeInTheDocument();
  });

  it('filters by category and clears back to the full catalog', () => {
    renderCollection();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mac' }));
    expect(screen.getByText(/Showing 1 of 1 products/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear All Filters' }));
    expect(screen.getByText(/Showing 12 of 14 products/i)).toBeInTheDocument();
  });

  it('applies the header search term when search is active', () => {
    renderCollection({ showSearch: true, search: 'p14' });

    expect(screen.getByText(/Showing 1 of 1 products/i)).toBeInTheDocument();
    expect(screen.getByText('P14')).toBeInTheDocument();
  });
});
