// Admin Product Performance page contract: loads GET /api/analytics/products
// with the stored admin token (Authorization: Bearer) and defaults
// metric=revenue&limit=10 (no category param), re-fetches when the metric /
// limit / category filters change, filters out entries whose product was
// deleted (null productId), and surfaces empty / loading / error states.
// The clock is frozen (only Date is faked) for consistency with the other
// analytics page specs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ProductAnalytics from '../../pages/productAnalytics';
import { backendUrl } from '../../config';

const productPayload = {
  success: true,
  data: {
    topProducts: [
      {
        _id: 'perf-1',
        productId: {
          _id: 'p1',
          name: 'iPhone 15 Pro',
          price: 999.5,
          image: ['https://example.com/iphone.png'],
          category: 'iPhone',
          subCategory: 'Pro',
        },
        views: 1200,
        addToCartCount: 45,
        purchaseCount: 12,
        revenue: 11994,
        conversionRate: 0.01,
      },
      {
        // Deleted product: analytics rows survive, productId is gone — the
        // page must filter this row out instead of crashing on productId.name.
        _id: 'perf-ghost',
        productId: null,
        views: 30,
        addToCartCount: 2,
        purchaseCount: 1,
        revenue: 500,
        conversionRate: 0.03,
      },
    ],
    productStats: {
      totalViews: 1200,
      totalAddToCart: 45,
      totalPurchases: 12,
      totalRevenue: 24680,
      averageConversionRate: 0.01,
    },
    categoryPerformance: [
      {
        _id: 'iPhone',
        totalViews: 3400,
        totalAddToCart: 60,
        totalPurchases: 9,
        totalRevenue: 11990,
        productCount: 4,
      },
    ],
  },
};

const okResponse = () => ({
  ok: true,
  json: async () => productPayload,
});

const defaultUrl = `${backendUrl}/api/analytics/products?metric=revenue&limit=10`;
const authHeaders = {
  headers: {
    Authorization: 'Bearer admin-token-123',
    'Content-Type': 'application/json',
  },
};

describe('ProductAnalytics (admin panel)', () => {
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

  it('requests the default metric/limit with the stored Bearer token and renders the report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductAnalytics />);

    expect(
      await screen.findByText('Product Performance Analytics')
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(defaultUrl, authHeaders);

    // Stats cards. 'Add to Cart' and 'Purchases' each appear twice: as the
    // stats label and as a metric-filter <option> in the filter bar.
    expect(screen.getByText('Total Views')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getAllByText('Add to Cart')).toHaveLength(2);
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getAllByText('Purchases')).toHaveLength(2);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('$24680.00')).toBeInTheDocument();
    expect(screen.getByText('Avg Conversion')).toBeInTheDocument();
    expect(screen.getByText('1.00%')).toBeInTheDocument();

    // Top product row (revenue metric) + detail lines.
    expect(screen.getByText('Top Products by Revenue')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('iPhone • Pro')).toBeInTheDocument();
    expect(screen.getByText('$999.50')).toBeInTheDocument();
    expect(screen.getByText('$11994.00')).toBeInTheDocument(); // metric value
    expect(screen.getByText('Views: 1,200')).toBeInTheDocument();
    expect(screen.getByText('Add to Cart: 45')).toBeInTheDocument();
    expect(screen.getByText('Purchases: 12')).toBeInTheDocument();
    expect(screen.getByText('Conversion: 1.00%')).toBeInTheDocument();

    // The null-productId row is filtered out: only rank 1 renders, no ghost.
    expect(screen.queryByText('Unknown Product')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    // Category performance card.
    expect(screen.getByText('Category Performance')).toBeInTheDocument();
    expect(screen.getByText('4 products')).toBeInTheDocument();
    expect(screen.getByText('3,400')).toBeInTheDocument();
    expect(screen.getByText('$11990.00')).toBeInTheDocument();
  });

  it('re-fetches with the new filters when metric, limit or category change', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<ProductAnalytics />);
    await screen.findByText('Product Performance Analytics');

    // Each filter change flips the page into its loading state until the
    // re-fetch settles, so wait for the report to come back before touching
    // the next select.
    fireEvent.change(screen.getByDisplayValue('Revenue'), {
      target: { value: 'views' },
    });
    await screen.findByText('Product Performance Analytics');

    fireEvent.change(screen.getByDisplayValue('Top 10'), {
      target: { value: '20' },
    });
    await screen.findByText('Product Performance Analytics');

    fireEvent.change(screen.getByDisplayValue('All Categories'), {
      target: { value: 'Mac' },
    });
    await waitFor(() =>
      expect(fetchMock.mock.lastCall?.[0]).toBe(
        `${backendUrl}/api/analytics/products?metric=views&limit=20&category=Mac`
      )
    );
    // Metric switch is reflected in the section heading and value formatting.
    expect(await screen.findByText('Top Products by Views')).toBeInTheDocument();
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(1);
  });

  it('shows the empty state when no products have analytics rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            topProducts: [],
            productStats: {
              totalViews: 0,
              totalAddToCart: 0,
              totalPurchases: 0,
              totalRevenue: 0,
              averageConversionRate: 0,
            },
            categoryPerformance: [],
          },
        }),
      })
    );

    render(<ProductAnalytics />);

    expect(
      await screen.findByText('No product performance data available')
    ).toBeInTheDocument();
  });

  it('stays in the loading state while the request is in flight', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );

    render(<ProductAnalytics />);

    expect(
      screen.queryByText('Product Performance Analytics')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Error:')).not.toBeInTheDocument();
  });

  it('shows the error state when the API responds not-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<ProductAnalytics />);

    expect(
      await screen.findByText('Error: Failed to fetch product data')
    ).toBeInTheDocument();
  });

  it('shows the empty state when the payload carries no data field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );

    render(<ProductAnalytics />);

    expect(await screen.findByText('No data available')).toBeInTheDocument();
  });
});
