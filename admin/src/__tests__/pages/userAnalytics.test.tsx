// Admin User Behavior page contract: loads GET /api/analytics/user-behavior
// with the stored admin token (Authorization: Bearer) and a default 30-day
// window, re-fetches when the window or the optional userId filter changes,
// renders activity / daily / active-user / product-interaction breakdowns
// with friendly action labels, and surfaces loading / error states.
// The clock is frozen (only Date is faked) so the default window asserts
// deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import UserAnalytics from '../../pages/userAnalytics';
import { backendUrl } from '../../config';

const userBehaviorPayload = {
  success: true,
  data: {
    activityBreakdown: [
      { _id: 'login', count: 10 },
      { _id: 'view_product', count: 25 },
    ],
    dailyActivity: [{ _id: '2026-10-19', count: 12 }],
    activeUsers: [
      {
        userId: 'u1',
        name: 'Ada Shopper',
        email: 'ada@example.com',
        activityCount: 35,
      },
    ],
    productInteractions: [
      {
        _id: 'i1',
        views: 100,
        addToCart: 20,
        purchases: 5,
        product: {
          _id: 'p1',
          name: 'iPhone 15 Pro',
          price: 999,
          image: ['https://example.com/iphone.png'],
          category: 'iPhone',
        },
      },
    ],
    period: {
      start: '2026-09-20T00:00:00.000Z',
      end: '2026-10-20T00:00:00.000Z',
    },
  },
};

const okResponse = () => ({
  ok: true,
  json: async () => userBehaviorPayload,
});

const defaultUrl = `${backendUrl}/api/analytics/user-behavior?startDate=2026-09-20&endDate=2026-10-20`;
const authHeaders = {
  headers: {
    Authorization: 'Bearer admin-token-123',
    'Content-Type': 'application/json',
  },
};

describe('UserAnalytics (admin panel)', () => {
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

    render(<UserAnalytics />);

    expect(await screen.findByText('User Behavior Analytics')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(defaultUrl, authHeaders);

    // Activity breakdown with friendly action labels.
    expect(screen.getByText('Activity Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('View Product')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();

    // Daily activity trend.
    expect(screen.getByText('Daily Activity Trend')).toBeInTheDocument();
    expect(screen.getByText('10/19/2026')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    // Most active users.
    expect(screen.getByText('Most Active Users')).toBeInTheDocument();
    expect(screen.getByText('Ada Shopper')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();

    // Product interactions.
    expect(
      screen.getByText('Product Interaction Analytics')
    ).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Conversion: 5.00%')).toBeInTheDocument();

    // Summary statistics: total activities (10 + 25) echoes the user's count.
    expect(screen.getByText('Summary Statistics')).toBeInTheDocument();
    expect(screen.getByText('Total Activities')).toBeInTheDocument();
    expect(screen.getAllByText('35')).toHaveLength(2);
    expect(screen.getByText('Active Users')).toBeInTheDocument();
    expect(screen.getByText('Products with Interactions')).toBeInTheDocument();

    // Period line: the dates are bare text nodes inside the paragraph
    // (<strong>Period:</strong> {start} to {end}), so match on the joined
    // paragraph text instead of a single date string. The tagName pin keeps
    // the wrapper div (same textContent) from matching too.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent === 'Period: 9/20/2026 to 10/20/2026'
      )
    ).toBeInTheDocument();
  });

  it('appends the userId param and badge when filtering by user ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<UserAnalytics />);
    await screen.findByText('User Behavior Analytics');

    fireEvent.change(screen.getByPlaceholderText('Filter by user ID'), {
      target: { value: 'u1' },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      `${backendUrl}/api/analytics/user-behavior?startDate=2026-09-20&endDate=2026-10-20&userId=u1`
    );
    // The badge is <strong>Filtered by User ID:</strong> {userId} — match on
    // the joined text instead of a split direct text node.
    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'Filtered by User ID: u1'
      )
    ).toBeInTheDocument();
  });

  it('re-fetches with the updated window when a date changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<UserAnalytics />);
    await screen.findByText('User Behavior Analytics');

    const startInput = screen.getByDisplayValue('2026-09-20');
    fireEvent.change(startInput, { target: { value: '2026-10-01' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      `${backendUrl}/api/analytics/user-behavior?startDate=2026-10-01&endDate=2026-10-20`
    );
  });

  it('stays in the loading state while the request is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    render(<UserAnalytics />);

    expect(
      screen.queryByText('User Behavior Analytics')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Error:')).not.toBeInTheDocument();
  });

  it('shows the error state when the API responds not-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<UserAnalytics />);

    expect(
      await screen.findByText('Error: Failed to fetch user behavior data')
    ).toBeInTheDocument();
  });
});
