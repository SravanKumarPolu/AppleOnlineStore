import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import PayPalPayment from '../../components/PayPalPayment';
import { createMockContextValue, makeProduct, renderWithProviders } from '../../test/helpers';
import type { DeliveryAddress } from '../../types';

// The PayPal SDK buttons are replaced with a stub — no network, no real
// financial flows. The assertions target OUR wrapper component's contract.
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalButtons: () => null,
}));

const address: DeliveryAddress = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  street: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62704',
  country: 'USA',
  phone: '5551234567',
};

describe('PayPalPayment (checkout integration wrapper)', () => {
  const renderPayment = (amount: number, onError = vi.fn()) =>
    renderWithProviders(
      <PayPalPayment
        amount={amount}
        address={address}
        onSuccess={vi.fn()}
        onError={onError}
        onCancel={vi.fn()}
      />,
      {
        contextValue: createMockContextValue({
          products: [makeProduct({ _id: 'p1', price: 10 })],
          cartItems: { p1: { Black: 2 } },
          token: 'test-token',
        }),
      },
    );

  it('renders the payment summary with the formatted amount', () => {
    renderPayment(123.5);

    expect(screen.getByText('PayPal Payment')).toBeInTheDocument();
    expect(screen.getByText(/Complete your purchase securely with PayPal/i)).toBeInTheDocument();
    expect(screen.getByText('$123.50')).toBeInTheDocument();
  });

  it('reports errors through onError when the fallback link is used', () => {
    const onError = vi.fn();
    renderPayment(50, onError);

    fireEvent.click(screen.getByRole('button', { name: /Try a different payment method/i }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
