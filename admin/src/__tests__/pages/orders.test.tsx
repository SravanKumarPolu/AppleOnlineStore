// Admin Orders page contract: loads the paginated order feed from
// /api/orders/all with the admin token (token header), renders the stats
// cards / pagination / order cards, disables the current status button, and
// PUTs status transitions to /api/orders/status followed by a re-fetch.
// axios.get/put are spied (not module-mocked) so apiTypes' real
// isAxiosError triage keeps working (same pattern as Login.test.tsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-toastify';

import Orders from '../../pages/orders';
import { backendUrl } from '../../config';

const config = {} as InternalAxiosRequestConfig;
const responseOf = (status: number, data: unknown): AxiosResponse =>
  ({ status, statusText: '', data, headers: {}, config }) as AxiosResponse;

const ORDER_STATUSES = [
  'Order Placed',
  'Packing',
  'Shipped',
  'Out for delivery',
  'Delivered',
  'Cancelled',
];

const order = {
  _id: 'a1b2c3d4e5f6a7b8c9d0e1f2',
  user: { _id: 'user-1', name: 'Ada Shopper', email: 'ada@example.com' },
  items: [
    {
      productId: 'p1',
      name: 'iPhone 15 Pro',
      image: 'https://example.com/a.png',
      price: 100,
      quantity: 2,
      color: 'Black',
    },
  ],
  address: {
    firstName: 'Ada',
    lastName: 'Shopper',
    email: 'ada@example.com',
    street: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    zipcode: '62701',
    country: 'USA',
    phone: '555-123-4567',
  },
  paymentMethod: 'PayPal',
  paymentStatus: 'pending',
  orderStatus: 'Order Placed',
  subtotal: 200,
  shipping: 10,
  total: 210,
  currency: 'USD',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

const ordersResponse = {
  success: true,
  orders: [order],
  pagination: {
    currentPage: 1,
    totalPages: 2,
    totalOrders: 25,
    hasNextPage: true,
    hasPrevPage: false,
    limit: 20,
  },
  filters: {
    users: [{ _id: 'user-1', name: 'Ada Shopper', email: 'ada@example.com' }],
    orderStatuses: ORDER_STATUSES,
    paymentStatuses: ['pending', 'completed', 'failed', 'refunded'],
  },
  stats: {
    totalOrders: 25,
    totalRevenue: 1234.56,
    pendingOrders: 7,
    completedOrders: 10,
    pendingPayments: 5,
    completedPayments: 15,
  },
};

const emptyResponse = {
  ...ordersResponse,
  orders: [],
};

const ordersUrl = `${backendUrl}/api/orders/all?page=1&limit=20&sortBy=createdAt&sortOrder=desc`;

describe('Orders (admin panel)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the order feed with the token header and renders it', async () => {
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: ordersResponse });

    render(<Orders token="admin-token-123" />);

    // Order card header (id tail, uppercase) + buyer + item + totals.
    expect(
      await screen.findByText(`Order #${order._id.slice(-8).toUpperCase()}`)
    ).toBeInTheDocument();
    expect(screen.getByText('Ada Shopper (ada@example.com)')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('$210.00')).toBeInTheDocument(); // order total
    // "Method:" and the value live in separate nodes (span + text) — assert
    // the value directly.
    expect(screen.getByText('PayPal')).toBeInTheDocument();

    // Stats cards + header counter + pagination info.
    expect(screen.getByText('$1,234.56')).toBeInTheDocument(); // total revenue
    expect(screen.getByText('Pending Orders')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument(); // total orders counter
    expect(screen.getByText('Showing 1 to 20 of 25 orders')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    // One status button per known status; the current one is disabled.
    const currentButton = screen.getByRole('button', { name: 'Order Placed' });
    expect(currentButton).toBeDisabled();
    for (const status of ORDER_STATUSES) {
      expect(screen.getByRole('button', { name: status })).toBeInTheDocument();
    }

    expect(getSpy).toHaveBeenCalledWith(ordersUrl, {
      headers: { token: 'admin-token-123' },
    });
  });

  it('stays in the loading state while the request is in flight', () => {
    vi.spyOn(axios, 'get').mockImplementation(() => new Promise(() => {}));

    render(<Orders token="admin-token-123" />);

    expect(screen.getByText('Loading orders...')).toBeInTheDocument();
    expect(screen.queryByText(/Order #/)).not.toBeInTheDocument();
  });

  it('does not call the API without a token and explains why', async () => {
    const getSpy = vi.spyOn(axios, 'get');

    render(<Orders token="" />);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'No authentication token found. Please login again.'
      )
    );
    expect(getSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('No orders found')).toBeInTheDocument();
  });

  it('maps a 401 to the re-authentication toast', async () => {
    const error = new AxiosError(
      'Request failed with status code 401',
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      responseOf(401, { success: false, message: 'Token expired' })
    );
    vi.spyOn(axios, 'get').mockRejectedValue(error);

    render(<Orders token="expired-token" />);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Authentication failed. Please login again.'
      )
    );
  });

  it('PUTs a status transition and re-fetches the list', async () => {
    const getSpy = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: ordersResponse });
    const putSpy = vi
      .spyOn(axios, 'put')
      .mockResolvedValue({ data: { success: true } });

    render(<Orders token="admin-token-123" />);
    await screen.findByText(`Order #${order._id.slice(-8).toUpperCase()}`);
    expect(getSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Shipped' }));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(
        `${backendUrl}/api/orders/status`,
        { orderId: order._id, status: 'Shipped' },
        { headers: { token: 'admin-token-123' } }
      )
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Order status updated successfully'
      )
    );
  });

  it('shows the empty state when the store has no matching orders', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ data: emptyResponse });

    render(<Orders token="admin-token-123" />);

    expect(await screen.findByText('No orders found')).toBeInTheDocument();
    expect(
      screen.getByText('There are no orders matching your filters.')
    ).toBeInTheDocument();
  });

  it('renders the live-feed indicator from the realtime context', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ data: ordersResponse });

    render(<Orders token="admin-token" />);

    await screen.findByText(`Order #${order._id.slice(-8).toUpperCase()}`);
    // No provider in this test → realtime is disconnected, and the operator is
    // told so instead of silently trusting a stale table.
    expect(screen.getByRole('status')).not.toHaveTextContent('Live updates on');
  });
});
