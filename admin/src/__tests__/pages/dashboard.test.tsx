
// Admin dashboard contract:
// - Uses the current authenticated token passed from App.tsx
// - Fetches dashboard analytics with Authorization: Bearer
// - Prevents caching of authenticated dashboard responses
// - Renders metrics, recent orders and low-stock alerts
// - Handles missing customer references, loading and API failures

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import Dashboard from '../../pages/dashboard';
import { backendUrl } from '../../config';

const TEST_TOKEN = 'admin-token-123';
const DASHBOARD_URL = `${backendUrl}/api/analytics/dashboard-summary`;

const summary = {
  data: {
    today: { sales: 270, orders: 2 },
    month: {
      sales: 1250.5,
      orders: 9,
      averageOrderValue: 135,
    },
    totalUsers: 42,
    totalProducts: 7,
    recentOrders: [
      {
        _id: 'order-1',
        total: 210,
        orderStatus: 'Order Placed',
        createdAt: '2026-10-24T10:00:00.000Z',
        userId: {
          name: 'Ada Shopper',
          email: 'ada@example.com',
        },
      },
    ],
    lowStockProducts: [
      {
        _id: 'p-1',
        name: 'Low Stock Widget',
        stockQuantity: 5,
      },
    ],
  },
};

const okResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    ...summary,
  }),
});

describe('Dashboard (admin panel)', () => {
  beforeEach(() => {
    localStorage.setItem('token', TEST_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('requests dashboard data with the current Bearer token and disables caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());

    vi.stubGlobal('fetch', fetchMock);

    render(<Dashboard token={TEST_TOKEN} />);

    expect(
      await screen.findByText("Today's Sales")
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      DASHBOARD_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json',
        }),
        cache: 'no-store',
      })
    );
  });

  it('uses the current token instead of a stale localStorage token', async () => {
    localStorage.setItem('token', 'old-expired-token');

    const fetchMock = vi.fn().mockResolvedValue(okResponse());

    vi.stubGlobal('fetch', fetchMock);

    render(<Dashboard token="new-valid-token" />);

    expect(
      await screen.findByText("Today's Sales")
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      DASHBOARD_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer new-valid-token',
        }),
        cache: 'no-store',
      })
    );
  });

  it('renders metric cards, recent orders and low-stock alerts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse())
    );

    render(<Dashboard token={TEST_TOKEN} />);

    expect(
      await screen.findByText('$270.00')
    ).toBeInTheDocument();

    expect(screen.getByText("Today's Sales")).toBeInTheDocument();
    expect(screen.getByText("Today's Orders")).toBeInTheDocument();
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Total Products')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();

    expect(
      screen.getByText("This Month's Summary")
    ).toBeInTheDocument();

    expect(screen.getByText('$1250.50')).toBeInTheDocument();
    expect(screen.getByText('$135.00')).toBeInTheDocument();

    expect(screen.getByText('Ada Shopper')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Order Placed')).toBeInTheDocument();

    expect(screen.getByText('Low Stock Alerts')).toBeInTheDocument();
    expect(screen.getByText('Low Stock Widget')).toBeInTheDocument();
    expect(screen.getByText('5 left')).toBeInTheDocument();
  });

  it('renders an order with a missing customer reference', async () => {
    const response = {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          ...summary.data,
          recentOrders: [
            {
              ...summary.data.recentOrders[0],
              userId: null,
            },
          ],
        },
      }),
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response)
    );

    render(<Dashboard token={TEST_TOKEN} />);

    expect(
      await screen.findByText('Deleted or unavailable customer')
    ).toBeInTheDocument();

    expect(
      screen.getByText('Customer information unavailable')
    ).toBeInTheDocument();

    expect(screen.getByText('$210.00')).toBeInTheDocument();
    expect(screen.getByText('Order Placed')).toBeInTheDocument();
  });

  it('stays in the loading state while the request is in flight', () => {
    // Keep fetch pending to verify the loading UI.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () => new Promise(() => {})
      )
    );

    render(<Dashboard token={TEST_TOKEN} />);

    expect(
      screen.getByText('Loading dashboard data...')
    ).toBeInTheDocument();

    expect(
      screen.queryByText("Today's Sales")
    ).not.toBeInTheDocument();
  });

  it('shows the HTTP status when the dashboard API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          message: 'Unauthorized',
        }),
      })
    );

    render(<Dashboard token={TEST_TOKEN} />);

    expect(
      await screen.findByText('Error Loading Dashboard')
    ).toBeInTheDocument();

    expect(
      screen.getByText('Failed to fetch dashboard data (HTTP 401)')
    ).toBeInTheDocument();

    expect(
      screen.queryByText("Today's Sales")
    ).not.toBeInTheDocument();
  });
});
