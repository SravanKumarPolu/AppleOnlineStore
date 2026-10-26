import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import ProductItems from '../../components/ProductItems';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

describe('ProductItems (product listing card)', () => {
  it('renders product name, price and links to the detail page', () => {
    const product = makeProduct({ _id: 'item-42', name: 'Wireless Earbuds', price: 99 });

    renderWithProviders(
      <ProductItems
        id={product._id}
        image={product.image}
        name={product.name}
        price={product.price}
        bestseller={product.bestseller}
      />,
      { contextValue: createMockContextValue({ currency: '$' }) },
    );

    // The card link has no overriding aria-label: its accessible name comes
    // from the visible product name (WCAG 2.5.3), not a synthetic string.
    const link = screen.getByRole('link', { name: /Wireless Earbuds/i });
    expect(link).toHaveAttribute('href', '/product/item-42');
    expect(screen.getByText('Wireless Earbuds')).toBeInTheDocument();
    expect(screen.getByText('$99')).toBeInTheDocument();
  });

  it('renders without a context provider without crashing', () => {
    // ProductItems bails out with null when the context is absent.
    const { container } = renderWithProviders(
      <ProductItems id="x" image={['/img.png']} name="X" price={1} />,
      { contextValue: null },
    );
    expect(container.firstChild).toBeNull();
  });
});
