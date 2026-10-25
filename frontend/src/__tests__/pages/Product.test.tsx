import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import Product from '../../pages/Product';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

describe('Product detail page (Rules of Hooks regression)', () => {
  const product = makeProduct({
    _id: 'detail-1',
    name: 'Flagship Phone',
    price: 999,
    description: 'The flagship phone for testing',
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black', 'Silver'],
  });

  const renderPage = (productId: string) =>
    renderWithProviders(
      <Routes>
        <Route path="/product/:productId" element={<Product />} />
      </Routes>,
      {
        route: `/product/${productId}`,
        contextValue: createMockContextValue({
          products: [product],
          isLoggedIn: true,
        }),
      },
    );

  it('renders product details for a known productId', async () => {
    renderPage('detail-1');

    // NOTE: RelatedProducts includes the product itself (same category +
    // subCategory, no self-exclusion), so the name and price legitimately
    // appear twice — once in the detail view, once in the related grid.
    expect((await screen.findAllByText('Flagship Phone')).length).toBeGreaterThanOrEqual(1);
    // The description renders twice: in the detail column and in the
    // Description/Reviews tab section.
    expect((await screen.findAllByText(/The flagship phone for testing/i)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('$999')).length).toBeGreaterThanOrEqual(1);
    // Category chips (detail view only)
    expect(screen.getByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('requires a color selection before enabling Add to Cart', async () => {
    const addToCart = vi.fn();
    renderWithProviders(
      <Routes>
        <Route path="/product/:productId" element={<Product />} />
      </Routes>,
      {
        route: '/product/detail-1',
        contextValue: createMockContextValue({
          products: [product],
          isLoggedIn: true,
          addToCart,
        }),
      },
    );

    // Hold the element reference across the re-render: after a color is
    // picked its label changes to "Add to Cart", which is also the label of
    // the quick-add button rendered by each RelatedProducts card.
    const addToCartButton = await screen.findByRole('button', { name: /Select a Color First/i });
    expect(addToCartButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    await waitFor(() => expect(addToCartButton).toBeEnabled());
    expect(addToCartButton).toHaveTextContent('Add to Cart');

    fireEvent.click(addToCartButton);
    expect(addToCart).toHaveBeenCalledWith('detail-1', 'Black');
  });

  it('stays in the loading state for an unknown productId', async () => {
    renderPage('does-not-exist');

    expect(await screen.findByText(/Loading product/i)).toBeInTheDocument();
    expect(screen.queryByText('Flagship Phone')).not.toBeInTheDocument();
  });
});
