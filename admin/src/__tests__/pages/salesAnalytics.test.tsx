// Admin Sales Analytics page contract: loads GET /api/analytics/sales with the
// stored admin token (Authorization: Bearer) and a default 30-day window
// (startDate = today - 30d, endDate = today), renders the summary cards /
// category / payment / status breakdowns, re-fetches when the date range
// changes or Refresh is clicked, and surfaces error / empty states.
// The clock is frozen (only Date is faked, RTL polling timers stay real) so
// the default window asserts deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import SalesAnalytics from '../../pages/salesAnalytics';
import { backendUrl } from '../../config';

const salesPayload = {
  success: true,
  data: {
    salesData: [],
    categoryBreakdown: [
      { category: 'iPhone', sales: 200, orders: 3, products: 2 },
      { category: 'Mac', sales: 50, orders: 1, products: 1 },
    ],
    paymentBreakdown: [
      { _id: 'cod', count: 4, total: 250 },
      { _id: 'stripe', count: 1, total: 100 },
    ],
    statusBreakdown: [
      { _id: 'Delivered', count: 2 },
      { _id: 'Order Placed', count: 5 },
    ],
    summary: {
      totalSales: 350,
      totalOrders: 12,
      averageOrderValue: 116.67,
      totalProducts: 7,
    },
    period: {
      start: '2026-09-20T00:00:00.000Z',
      end: '2026-10-20T00:00:00.000Z',
    },
  },
};

const okResponse = () => ({
  ok: true,
  json: async () => salesPayload,
});

// Frozen "today": 2026-10-20 (UTC) -> default window 2026-09-20 .. 2026-10-20.
const defaultUrl = `${backendUrl}/api/analytics/sales?startDate=2026-09-20&endDate=2026-10-20`;
const authHeaders = {
  headers: {
    Authorization: 'Bearer admin-token-123',
    'Content-Type': 'application/json',
  },
};

describe('SalesAnalytics (admin panel)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    localStorage.setItem('token', 'admin-token-123');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('requests the default 30-day window with the stored Bearer token and renders the report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<SalesAnalytics />);

    expect(await screen.findByText('Sales Analytics')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(defaultUrl, authHeaders);

    // Summary cards.
    expect(screen.getByText('Total Sales')).toBeInTheDocument();
    expect(screen.getByText('$350.00')).toBeInTheDocument();
    expect(screen.getByText('Total Orders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Average Order Value')).toBeInTheDocument();
    expect(screen.getByText('$116.67')).toBeInTheDocument();
    expect(screen.getByText('Total Products')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();

    // Analysis period line.
    expect(screen.getByText('From:')).toBeInTheDocument();
    expect(screen.getByText('9/20/2026')).toBeInTheDocument();
    expect(screen.getByText('To:')).toBeInTheDocument();
    expect(screen.getByText('10/20/2026')).toBeInTheDocument();

    // Category breakdown.
    expect(screen.getByText('Sales by Category')).toBeInTheDocument();
    expect(screen.getByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('3 orders')).toBeInTheDocument();
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(screen.getByText('Mac')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('1 orders')).toBeInTheDocument();
    expect(screen.getByText('1 products')).toBeInTheDocument();

    // Payment methods breakdown.
    expect(screen.getByText('Payment Methods')).toBeInTheDocument();
    expect(screen.getByText('cod')).toBeInTheDocument();
    expect(screen.getByText('4 transactions')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
    expect(screen.getByText('stripe')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();

    // Order status breakdown.
    expect(screen.getByText('Order Status')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Order Placed')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('re-fetches with the updated window when a date changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<SalesAnalytics />);
    await screen.findByText('Sales Analytics');

    const startInput = screen.getByDisplayValue('2026-09-20');
    fireEvent.change(startInput, { target: { value: '2026-09-01' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      `${backendUrl}/api/analytics/sales?startDate=2026-09-01&endDate=2026-10-20`
    );
  });

  it('re-fetches the same window when Refresh is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<SalesAnalytics />);
    await screen.findByText('Sales Analytics');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.lastCall?.[0]).toBe(defaultUrl);
  });

  it('stays in the loading state while the request is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    render(<SalesAnalytics />);

    expect(screen.getByText('Loading sales analytics...')).toBeInTheDocument();
    expect(screen.queryByText('Sales by Category')).not.toBeInTheDocument();
  });

  it('shows the error state when the API responds not-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<SalesAnalytics />);

    expect(
      await screen.findByText('Error: Failed to fetch sales data')
    ).toBeInTheDocument();
    expect(screen.queryByText('Sales by Category')).not.toBeInTheDocument();
  });

  it('shows the empty state when the payload carries no data field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );

    render(<SalesAnalytics />);

    expect(await screen.findByText('No data available')).toBeInTheDocument();
  });
});
