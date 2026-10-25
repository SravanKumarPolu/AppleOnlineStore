import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import PlaceOrder from '../../pages/PlaceOrder';
import {
  createMockContextValue,
  makeProduct,
  renderWithProviders,
} from '../../test/helpers';
import type { ShopContextType } from '../../types';

// AddressBook fetches saved addresses on mount — stub it (network-free).
vi.mock('../../components/AddressBook', () => ({
  default: () => <div data-testid="address-book-stub" />,
}));

// PayPal SDK: passthrough provider + inert buttons (only rendered when the
// user selects the PayPal branch).
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  PayPalButtons: () => null,
}));

// VITE_BACKEND_URL is unset under vitest, so the page falls back to this.
const backendUrl = 'http://localhost:3001';

const product = makeProduct({
  _id: 'p1',
  name: 'Test Product',
  price: 10,
  image: ['img.png'],
});

const address = {
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

const fillAddress = () => {
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: address.firstName },
  });
  fireEvent.change(screen.getByLabelText('Last name'), {
    target: { value: address.lastName },
  });
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: address.email },
  });
  fireEvent.change(screen.getByLabelText('Street'), {
    target: { value: address.street },
  });
  fireEvent.change(screen.getByLabelText('City'), {
    target: { value: address.city },
  });
  fireEvent.change(screen.getByLabelText('State'), {
    target: { value: address.state },
  });
  fireEvent.change(screen.getByLabelText('Zip code'), {
    target: { value: address.zipcode },
  });
  fireEvent.change(screen.getByLabelText('Country'), {
    target: { value: address.country },
  });
  fireEvent.change(screen.getByLabelText('Phone'), {
    target: { value: address.phone },
  });
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, order: { _id: 'order-1' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderCheckout = (overrides: Partial<ShopContextType> = {}) => {
  const setCartItems = overrides.setCartItems ?? vi.fn();
  const navigate = overrides.navigate ?? vi.fn();
  const contextValue = createMockContextValue({
    products: [product],
    cartItems: { p1: { Black: 2 } },
    token: 'test-token',
    isLoggedIn: true,
    getCartAmount: () => 20,
    ...overrides,
    setCartItems,
    navigate,
  });
  const utils = renderWithProviders(<PlaceOrder />, { contextValue });
  return { ...utils, setCartItems, navigate };
};

const placeOrderClick = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

describe('PlaceOrder — COD/Card checkout creates real orders (K-1 fix)', () => {
  it('submits a COD order to the order API, clears the cart and navigates', async () => {
    const { setCartItems, navigate } = renderCheckout();

    fillAddress();
    placeOrderClick();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${backendUrl}/api/orders`);
    expect(init.method).toBe('POST');
    // AF-1 contract: every checkout attempt carries an Idempotency-Key so the
    // backend can replay (not duplicate) retried submissions. Format accepts
    // either crypto.randomUUID() (36 chars, dashed) or the 32-hex fallback.
    expect(init.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        token: 'test-token',
      })
    );
    expect(init.headers['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{32}$/i
    );

    const body = JSON.parse(init.body);
    expect(body.paymentMethod).toBe('COD');
    expect(body.items).toEqual([
      {
        productId: 'p1',
        name: 'Test Product',
        image: 'img.png',
        price: 10,
        quantity: 2,
        color: 'Black',
      },
    ]);
    expect(body.address).toEqual(address);

    await waitFor(() => expect(setCartItems).toHaveBeenCalledWith({}));
    expect(navigate).toHaveBeenCalledWith('/orders');
  });

  it('submits a Card order with the backend Card payment method', async () => {
    renderCheckout();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select payment method: Credit/Debit Card' })
    );
    fillAddress();
    placeOrderClick();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.paymentMethod).toBe('Card');
    expect(body.items).toHaveLength(1);
  });

  it('keeps the cart and stays on checkout when the order API fails', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: 'boom' }),
    });
    const { setCartItems, navigate } = renderCheckout();

    fillAddress();
    placeOrderClick();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(setCartItems).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Place order' })).toHaveTextContent(
      'PLACE ORDER'
    );
  });

  it('guards against an empty cart', () => {
    renderCheckout({ cartItems: {} });

    fillAddress();
    placeOrderClick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Place order' })).toHaveTextContent(
      'PLACE ORDER'
    );
  });

  it('requires the shopper to be logged in', () => {
    renderCheckout({ isLoggedIn: false, token: '' });

    fillAddress();
    placeOrderClick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Place order' })).toHaveTextContent(
      'PLACE ORDER'
    );
  });
});

describe('PlaceOrder — PayPal branch is unchanged (no regression)', () => {
  // SECURITY FIX regression: a live PayPal client ID is no longer committed
  // as a source-code fallback. The branch test stubs the env var so the SDK
  // flow renders; the unconfigured state has its own test below.
  beforeEach(() => {
    import.meta.env.VITE_PAYPAL_CLIENT_ID = 'test-client-id';
  });
  afterEach(() => {
    delete import.meta.env.VITE_PAYPAL_CLIENT_ID;
  });

  it('switches to the PayPal SDK flow without calling the generic order API', async () => {
    renderCheckout();

    fillAddress();
    fireEvent.click(
      screen.getByRole('button', { name: 'Select payment method: PayPal' })
    );
    placeOrderClick();

    // The PayPal payment screen replaces the checkout form.
    expect(await screen.findByText('PayPal Payment')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows an explicit configuration message (never a blank SDK) when VITE_PAYPAL_CLIENT_ID is unset', async () => {
    delete import.meta.env.VITE_PAYPAL_CLIENT_ID;

    renderCheckout();
    fillAddress();
    fireEvent.click(
      screen.getByRole('button', { name: 'Select payment method: PayPal' })
    );
    placeOrderClick();

    // Security-fix behavior: no hardcoded credential fallback, clear message.
    expect(await screen.findByTestId('paypal-unconfigured')).toBeInTheDocument();
    expect(
      screen.getByText(/VITE_PAYPAL_CLIENT_ID is not set/i)
    ).toBeInTheDocument();
  });
});

describe('PlaceOrder — saving the delivery form to the address book (K-11 fix)', () => {
  it('POSTs the filled address to the routed plural /api/user/addresses', async () => {
    renderCheckout();

    // "Add address" switches the delivery form into edit mode so the Save
    // submit button appears (mode starts as 'add').
    fireEvent.click(screen.getByRole('button', { name: 'Add address' }));
    fillAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalled()
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${backendUrl}/api/user/addresses`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      token: 'test-token',
    });
    expect(JSON.parse(init.body)).toEqual(address);
  });
});
