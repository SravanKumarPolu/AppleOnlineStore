// Admin dashboard contract: fetches /api/analytics/dashboard-summary with the
// stored admin token (Authorization: Bearer), renders the metric cards from
// the response, and shows the error state when the API fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import Dashboard from '../../pages/dashboard';
import { backendUrl } from '../../config';

const summary = {
  data: {
    today: { sales: 270, orders: 2 },
    month: { sales: 1250.5, orders: 9, averageOrderValue: 135 },
    totalUsers: 42,
    totalProducts: 7,
    recentOrders: [
      {
        _id: 'order-1',
        total: 210,
        orderStatus: 'Order Placed',
        createdAt: '2026-10-24T10:00:00.000Z',
        userId: { name: 'Ada Shopper', email: 'ada@example.com' },
      },
    ],
    lowStockProducts: [
      { _id: 'p-1', name: 'Low Stock Widget', stockQuantity: 5 },
    ],
  },
};

const okResponse = () => ({
  ok: true,
  json: async () => ({ success: true, ...summary }),
});

describe('Dashboard (admin panel)', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'admin-token-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('requests the dashboard summary with the stored Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<Dashboard />);

    expect(await screen.findByText("Today's Sales")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/api/analytics/dashboard-summary`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-token-123',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('renders the metric cards and recent orders from the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));

    render(<Dashboard />);

    expect(await screen.findByText('$270.00')).toBeInTheDocument(); // today's sales
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Total Products')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('This Month\'s Summary')).toBeInTheDocument();
    expect(screen.getByText('$1250.50')).toBeInTheDocument(); // month total sales
    expect(screen.getByText('$135.00')).toBeInTheDocument(); // average order value

    expect(screen.getByText('Ada Shopper')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Order Placed')).toBeInTheDocument();

    expect(screen.getByText('Low Stock Alerts')).toBeInTheDocument();
    expect(screen.getByText('Low Stock Widget')).toBeInTheDocument();
    expect(screen.getByText('5 left')).toBeInTheDocument();
  });

  it('stays in the loading state while the request is in flight', async () => {
    // Never-resolving fetch: the loading UI is observable deterministically.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));

    render(<Dashboard />);

    expect(screen.getByText('Loading dashboard data...')).toBeInTheDocument();
    expect(screen.queryByText("Today's Sales")).not.toBeInTheDocument();
  });

  it('shows the error state when the API responds not-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<Dashboard />);

    expect(
      await screen.findByText('Error Loading Dashboard')
    ).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch dashboard data')).toBeInTheDocument();
    expect(screen.queryByText("Today's Sales")).not.toBeInTheDocument();
  });
});
