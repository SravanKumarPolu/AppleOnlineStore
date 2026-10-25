import React, { useCallback, useEffect, useState } from 'react';
import { backendUrl, currency } from '../config';

interface SalesData {
  _id: string;
  totalSales: number;
  totalOrders: number;
  totalProducts: number;
  averageOrderValue: number;
}

interface CategoryBreakdown {
  category: string;
  sales: number;
  orders: number;
  products: number;
}

interface PaymentBreakdown {
  _id: string;
  count: number;
  total: number;
}

interface StatusBreakdown {
  _id: string;
  count: number;
}

interface SalesAnalyticsData {
  salesData: SalesData[];
  categoryBreakdown: CategoryBreakdown[];
  paymentBreakdown: PaymentBreakdown[];
  statusBreakdown: StatusBreakdown[];
  summary: {
    totalSales: number;
    totalOrders: number;
    averageOrderValue: number;
    totalProducts: number;
  };
  period: {
    start: string;
    end: string;
  };
}

const SalesAnalytics: React.FC = () => {
  const [data, setData] = useState<SalesAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

  const fetchSalesData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });

      const response = await fetch(`${backendUrl}/api/analytics/sales?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sales data');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchSalesData();
  }, [fetchSalesData]);

  const formatCurrency = (amount: number) => {
    return `${currency}${amount.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Delivered':
        return 'badge-success';
      case 'Cancelled':
        return 'badge-error';
      case 'Order Placed':
        return 'badge-info';
      case 'Packing':
        return 'badge-warning';
      case 'Shipped':
        return 'badge-info';
      case 'Out for delivery':
        return 'badge-warning';
      default:
        return 'badge-info';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-4"></div>
          <p className="text-neutral-600">Loading sales analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-modern p-6 border-error-200 bg-error-50">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-error-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-error-800 font-medium">Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-modern p-6 text-center">
        <p className="text-neutral-600">No data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-1 font-bold text-neutral-900 mb-2">Sales Analytics</h1>
          <p className="text-body text-neutral-600">Comprehensive sales performance insights</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Start Date</label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                className="input-modern w-40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">End Date</label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                className="input-modern w-40"
              />
            </div>
          </div>
          <button
         onClick={fetchSalesData}
          className="btn-modern btn-secondary hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 group px-8 py-4 hover:scale-105 transition-all duration-300"
        >
          <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="font-semibold">Refresh</span>
        </button>
       
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card-elevated card-modern p-6">
          <div className="flex items-center">
            <div className="p-3 bg-success-100 rounded-xl">
              <svg className="w-6 h-6 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-caption text-neutral-500 mb-1">Total Sales</p>
              <p className="text-heading-3 font-bold text-neutral-900">{formatCurrency(data.summary.totalSales)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern p-6">
          <div className="flex items-center">
            <div className="p-3 bg-primary-100 rounded-xl">
              <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-caption text-neutral-500 mb-1">Total Orders</p>
              <p className="text-heading-3 font-bold text-neutral-900">{data.summary.totalOrders}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern p-6">
          <div className="flex items-center">
            <div className="p-3 bg-warning-100 rounded-xl">
              <svg className="w-6 h-6 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-caption text-neutral-500 mb-1">Average Order Value</p>
              <p className="text-heading-3 font-bold text-neutral-900">{formatCurrency(data.summary.averageOrderValue)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern p-6">
          <div className="flex items-center">
            <div className="p-3 bg-error-100 rounded-xl">
              <svg className="w-6 h-6 text-error-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-caption text-neutral-500 mb-1">Total Products</p>
              <p className="text-heading-3 font-bold text-neutral-900">{data.summary.totalProducts}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Period Info */}
      <div className="card-elevated card-modern p-6">
        <h2 className="text-heading-3 font-semibold text-neutral-900 mb-4">Analysis Period</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-caption text-neutral-500">From:</span>
            <span className="font-medium text-neutral-900">{formatDate(data.period.start)}</span>
          </div>
          <div className="w-px h-4 bg-neutral-300"></div>
          <div className="flex items-center gap-2">
            <span className="text-caption text-neutral-500">To:</span>
            <span className="font-medium text-neutral-900">{formatDate(data.period.end)}</span>
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="card-elevated card-modern p-6">
        <h2 className="text-heading-3 font-semibold text-neutral-900 mb-6">Sales by Category</h2>
        <div className="space-y-4">
          {data.categoryBreakdown.map((category) => (
            <div key={category.category} className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl">
              <div>
                <h3 className="font-semibold text-neutral-900">{category.category}</h3>
                <p className="text-body-small text-neutral-600">{category.orders} orders</p>
              </div>
              <div className="text-right">
                <p className="text-heading-4 font-bold text-primary-600">{formatCurrency(category.sales)}</p>
                <p className="text-caption text-neutral-500">{category.products} products</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Payment and Status Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Payment Breakdown */}
        <div className="card-elevated card-modern p-6">
          <h2 className="text-heading-3 font-semibold text-neutral-900 mb-6">Payment Methods</h2>
          <div className="space-y-4">
            {data.paymentBreakdown.map((payment) => (
              <div key={payment._id} className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl">
                <div>
                  <h3 className="font-semibold text-neutral-900 capitalize">{payment._id}</h3>
                  <p className="text-body-small text-neutral-600">{payment.count} transactions</p>
                </div>
                <div className="text-right">
                  <p className="text-heading-4 font-bold text-success-600">{formatCurrency(payment.total)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="card-elevated card-modern p-6">
          <h2 className="text-heading-3 font-semibold text-neutral-900 mb-6">Order Status</h2>
          <div className="space-y-4">
            {data.statusBreakdown.map((status) => (
              <div key={status._id} className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className={`badge ${getStatusColor(status._id)}`}>
                    {status._id}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-heading-4 font-bold text-neutral-900">{status.count}</p>
                  <p className="text-caption text-neutral-500">orders</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesAnalytics; 