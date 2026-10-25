// Admin Search Analytics page contract: loads GET /api/analytics/search with
// the stored admin token (Authorization: Bearer), a default 30-day window and
// limit=10, re-fetches when the limit filter changes, renders the search
// stats / popular searches / trends / category breakdown / performance
// metrics / insights, and surfaces loading / error / empty states.
// The clock is frozen (only Date is faked) so the default window asserts
// deterministically.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import SearchAnalytics from '../../pages/searchAnalytics';
import { backendUrl } from '../../config';

const searchPayload = {
  success: true,
  data: {
    popularSearches: [
      {
        _id: 'q1',
        query: 'iphone',
        count: 25,
        resultsCount: 8,
        category: 'iPhone',
        date: '2026-10-19T00:00:00.000Z',
      },
    ],
    searchTrends: [{ _id: '2026-10-19', totalSearches: 10, uniqueQueries: 4 }],
    categorySearches: [{ _id: 'iPhone', totalSearches: 12, uniqueQueries: 5 }],
    searchStats: { totalSearches: 37, uniqueQueries: 9, averageResults: 6.4 },
    period: {
      start: '2026-09-20T00:00:00.000Z',
      end: '2026-10-20T00:00:00.000Z',
    },
  },
};

const okResponse = () => ({
  ok: true,
  json: async () => searchPayload,
});

const defaultUrl = `${backendUrl}/api/analytics/search?startDate=2026-09-20&endDate=2026-10-20&limit=10`;
const authHeaders = {
  headers: {
    Authorization: 'Bearer admin-token-123',
    'Content-Type': 'application/json',
  },
};

describe('SearchAnalytics (admin panel)', () => {
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

  it('requests the default window and limit with the stored Bearer token and renders the report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<SearchAnalytics />);

    expect(await screen.findByText('Search Analytics')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(defaultUrl, authHeaders);

    // Search statistics cards.
    expect(screen.getByText('Total Searches')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('Unique Queries')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Avg Results')).toBeInTheDocument();
    // Once in the stat card, once in the performance-metrics card.
    expect(screen.getAllByText('6.4')).toHaveLength(2);

    // Popular searches list.
    expect(screen.getByText('Popular Searches')).toBeInTheDocument();
    expect(screen.getByText('"iphone"')).toBeInTheDocument();
    expect(screen.getByText('8 results')).toBeInTheDocument();
    // 'iPhone' renders three times: the popular-search category badge, the
    // Search-by-Category card heading, and that card's colored badge chip.
    expect(screen.getAllByText('iPhone')).toHaveLength(3);
    expect(screen.getAllByText('25')).toHaveLength(2); // row count + most popular metric

    // Search trends.
    expect(screen.getByText('Search Trends')).toBeInTheDocument();
    expect(screen.getByText('10/19/2026')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('4 unique')).toBeInTheDocument();

    // Category breakdown.
    expect(screen.getByText('Search by Category')).toBeInTheDocument();
    expect(screen.getByText('Total Searches:')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Unique Queries:')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Avg Searches per Query:')).toBeInTheDocument();
    expect(screen.getByText('2.4')).toBeInTheDocument();

    // Performance metrics (percent values render with a trailing % node).
    expect(screen.getByText('Query Diversity')).toBeInTheDocument();
    expect(screen.getByText('24.3%')).toBeInTheDocument(); // 9/37 * 100
    expect(screen.getByText('Avg Results per Search')).toBeInTheDocument();
    expect(screen.getByText('Searches per Query')).toBeInTheDocument();
    expect(screen.getByText('4.1')).toBeInTheDocument(); // 37/9, no % suffix in this card
    expect(screen.getByText('Most Popular Search')).toBeInTheDocument();

    // Insights.
    expect(screen.getByText('Top Search')).toBeInTheDocument();
    expect(
      screen.getByText('"iphone" with 25 searches')
    ).toBeInTheDocument();

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

  it('re-fetches with the new limit when the Top Searches filter changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<SearchAnalytics />);
    await screen.findByText('Search Analytics');

    fireEvent.change(screen.getByDisplayValue('Top 10'), {
      target: { value: '5' },
    });

    await waitFor(() =>
      expect(fetchMock.mock.lastCall?.[0]).toBe(
        `${backendUrl}/api/analytics/search?startDate=2026-09-20&endDate=2026-10-20&limit=5`
      )
    );
  });

  it('stays in the loading state while the request is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    render(<SearchAnalytics />);

    expect(screen.queryByText('Search Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Error:')).not.toBeInTheDocument();
  });

  it('shows the error state when the API responds not-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<SearchAnalytics />);

    expect(
      await screen.findByText('Error: Failed to fetch search data')
    ).toBeInTheDocument();
  });

  it('shows the empty state when the payload carries no data field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );

    render(<SearchAnalytics />);

    expect(await screen.findByText('No data available')).toBeInTheDocument();
  });
});
