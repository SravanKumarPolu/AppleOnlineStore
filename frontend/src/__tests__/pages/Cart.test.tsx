import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import Cart from '../../pages/Cart';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';

// Cart is the storefront's money path: it is the last screen before checkout,
// so the quantity controls, the removal path and the totals must be locked.
// The page previously had no automated coverage at all.

describe('Cart page', () => {
  const product = makeProduct({ _id: 'product-1', name: 'Test Product', price: 100 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderCart = (overrides = {}) =>
    renderWithProviders(<Cart />, {
      contextValue: createMockContextValue({
        isLoggedIn: true,
        products: [product],
        cartItems: { 'product-1': { Black: 2 } },
        getCartAmount: vi.fn(() => 200),
        ...overrides,
      }),
    });

  it('renders the line items and the server-matching totals (subtotal + shipping)', () => {
    renderCart();

    expect(screen.getByText('Test Product')).toBeInTheDocument();
    // Quantity is read from the cart map, not from local component state.
    expect(screen.getByRole('spinbutton')).toHaveValue(2);
    // CartTotal: 200 subtotal + 10 delivery fee.
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.getByText('$210.00')).toBeInTheDocument();
  });

  it('increments and decrements the line quantity through updateQuantity', () => {
    const updateQuantity = vi.fn();
    renderCart({ updateQuantity });

    fireEvent.click(screen.getByRole('button', { name: /Increase quantity of Test Product/i }));
    expect(updateQuantity).toHaveBeenLastCalledWith('product-1', 'Black', 3);

    fireEvent.click(screen.getByRole('button', { name: /Decrease quantity of Test Product/i }));
    expect(updateQuantity).toHaveBeenLastCalledWith('product-1', 'Black', 1);
  });

  it('never decrements below 1 (the floor is applied before the state update)', () => {
    const updateQuantity = vi.fn();
    renderCart({
      updateQuantity,
      cartItems: { 'product-1': { Black: 1 } },
      getCartAmount: vi.fn(() => 100),
    });

    fireEvent.click(screen.getByRole('button', { name: /Decrease quantity of Test Product/i }));
    expect(updateQuantity).toHaveBeenLastCalledWith('product-1', 'Black', 1);
  });

  it('removes a line by setting its quantity to 0', () => {
    const updateQuantity = vi.fn();
    renderCart({ updateQuantity });

    fireEvent.click(screen.getByRole('button', { name: /Remove item/i }));
    expect(updateQuantity).toHaveBeenCalledWith('product-1', 'Black', 0);
  });

  it('shows the empty state (and no checkout CTA) when the cart has no quantities', () => {
    renderCart({ cartItems: { 'product-1': { Black: 0 } }, getCartAmount: vi.fn(() => 0) });

    expect(screen.getByText(/Your cart is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proceed to Checkout/i })).not.toBeInTheDocument();
  });

  it('sends unauthenticated shoppers to the login page', () => {
    const navigate = vi.fn();
    renderCart({ isLoggedIn: false, navigate });

    expect(screen.getByText(/Please Login/i)).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('navigates to checkout from the summary CTA', () => {
    const navigate = vi.fn();
    renderCart({ navigate });

    fireEvent.click(screen.getByRole('button', { name: /Proceed to Checkout/i }));
    expect(navigate).toHaveBeenCalledWith('/place-order');
  });
});
