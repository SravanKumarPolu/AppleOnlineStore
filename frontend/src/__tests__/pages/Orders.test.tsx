import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import Orders from '../../pages/Orders';
import { createMockContextValue, renderWithProviders } from '../../test/helpers';

// Orders navigates with react-router's useNavigate (not the context wrapper),
// so the spy has to intercept the hook itself.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

// Order history is a customer journey that had no automated coverage: the page
// must send the shopper's own token, render the persisted order (items, totals,
// shipping address, payment method/status) and re-query on filter/page changes.

const order = {
  _id: '65f1c2d3e4b5a69788776655',
  userId: 'user-1',
  items: [
    {
      productId: 'p1',
      name: 'Test Product',
      image: '/images/test-product.jpg',
      price: 100,
      quantity: 2,
      color: 'Black',
    },
  ],
  address: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    street: '1 Analytical Way',
    city: 'Springfield',
    state: 'IL',
    zipcode: '62701',
    country: 'USA',
    phone: '5550100',
  },
  paymentMethod: 'COD',
  paymentStatus: 'pending',
  orderStatus: 'Order Placed',
  subtotal: 200,
  shipping: 10,
  total: 210,
  currency: 'USD',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const jsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe('Orders page (order history)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    navigateSpy.mockReset();
    fetchMock = vi.fn(() =>
      jsonResponse({
        success: true,
        orders: [order],
        pagination: { currentPage: 1, totalPages: 2, totalOrders: 2 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  const renderOrders = (overrides = {}) =>
    renderWithProviders(<Orders />, {
      contextValue: createMockContextValue({
        isLoggedIn: true,
        token: 'shopper-token',
        currency: '$',
        ...overrides,
      }),
    });

  it('sends the shopper token to /api/orders/userorders with the default query', async () => {
    renderOrders();

    await screen.findByText(/Order #/i);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/orders/userorders');
    expect(init.method).toBe('POST');
    expect(init.headers.token).toBe('shopper-token');
    expect(JSON.parse(init.body)).toEqual({ page: 1, limit: 10, status: undefined });
  });

  it('renders the persisted order: id suffix, item, totals, address, payment', async () => {
    renderOrders();

    // Order number is the last 8 characters, upper-cased.
    expect(await screen.findByText('Order #88776655')).toBeInTheDocument();
    // 'Order Placed' is both the status badge and a <select> option.
    expect(screen.getAllByText('Order Placed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Pending')).toBeInTheDocument();

    expect(screen.getByText('Test Product')).toBeInTheDocument();
    // Split text nodes: assert on the paragraph's full text, not `getByText`.
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Color: Black | Quantity: 2')).toBeTruthy();
    expect(screen.getByText('$100.00 each')).toBeInTheDocument();
    // Line total and subtotal are both $200.00 (100 × 2).
    expect(screen.getAllByText('$200.00')).toHaveLength(2);

    expect(screen.getByText('$210.00')).toBeInTheDocument(); // order total
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('1 Analytical Way')).toBeInTheDocument();
    expect(screen.getByText('Method: COD')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('shows the empty state and offers a way back to shopping', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({ success: true, orders: [], pagination: { currentPage: 1, totalPages: 1 } })
    );
    renderOrders();

    expect(await screen.findByText('No orders found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start Shopping/i }));
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('re-queries with the selected status when the filter changes', async () => {
    renderOrders();
    await screen.findByText(/Order #/i);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Shipped' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      page: 1,
      limit: 10,
      status: 'Shipped',
    });
  });

  it('pages forward and back, re-querying with the new page number', async () => {
    renderOrders();
    await screen.findByText(/Page 1 of 2/i);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).page).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).page).toBe(1);
  });

  it('surfaces an API failure as a toast instead of an empty page', async () => {
    fetchMock.mockImplementation(() => jsonResponse({ success: false, message: 'Server exploded' }));
    renderOrders();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server exploded'));
  });

  it('redirects anonymous shoppers to login and never queries the API', () => {
    renderOrders({ isLoggedIn: false, token: '' });

    expect(navigateSpy).toHaveBeenCalledWith('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
