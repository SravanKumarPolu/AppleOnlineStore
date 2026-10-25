import React, { useEffect, useState } from 'react';
import { backendUrl, currency } from '../config';

interface DashboardData {
  today: {
    sales: number;
    orders: number;
  };
  month: {
    sales: number;
    orders: number;
    averageOrderValue: number;
  };
  totalUsers: number;
  totalProducts: number;
  recentOrders: Array<{
    _id: string;
    total: number;
    orderStatus: string;
    createdAt: string;
    userId: {
      name: string;
      email: string;
    };
  }>;
  lowStockProducts: Array<{
    _id: string;
    name: string;
    stockQuantity: number;
  }>;
}

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`${backendUrl}/api/analytics/dashboard-summary`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `${currency}${amount.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-8"></div>
          <p className="text-neutral-600 font-semibold text-lg mb-2">Loading dashboard data...</p>
          <p className="text-caption text-neutral-500">Please wait while we fetch your analytics</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-modern p-10 border-error-200 bg-error-50">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-error-100 rounded-2xl flex items-center justify-center">
            <svg className="w-8 h-8 text-error-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-error-800 font-bold text-xl mb-2">Error Loading Dashboard</p>
            <p className="text-error-700 font-medium">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card-modern p-10 text-center">
        <div className="w-20 h-20 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-neutral-600 font-semibold text-xl mb-2">No data available</p>
        <p className="text-caption text-neutral-500">Try refreshing the page</p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-1 font-bold gradient-text mb-4">Dashboard</h1>
          <p className="text-body-large text-neutral-600 font-medium">Overview of your e-commerce performance and key metrics</p>
        </div>
        <button
          onClick={fetchDashboardData}
          className="btn-modern btn-secondary hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 group px-8 py-4 hover:scale-105 transition-all duration-300"
        >
          <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="font-semibold">Refresh</span>
        </button>
      </div>

      {/* Enhanced Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <div className="card-elevated p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center">
            <div className="p-5 bg-gradient-to-br from-success-100 to-success-200 rounded-2xl shadow-lg shadow-success-500/20 hover:scale-110 transition-transform duration-300">
              <svg className="w-9 h-9 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-6">
              <p className="text-caption text-neutral-500 mb-3 font-semibold">Today's Sales</p>
              <p className="text-heading-2 font-bold text-neutral-900">{formatCurrency(data.today.sales)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center">
            <div className="p-5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-2xl shadow-lg shadow-primary-500/20 hover:scale-110 transition-transform duration-300">
              <svg className="w-9 h-9 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="ml-6">
              <p className="text-caption text-neutral-500 mb-3 font-semibold">Today's Orders</p>
              <p className="text-heading-2 font-bold text-neutral-900">{data.today.orders}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center">
            <div className="p-5 bg-gradient-to-br from-warning-100 to-warning-200 rounded-2xl shadow-lg shadow-warning-500/20 hover:scale-110 transition-transform duration-300">
              <svg className="w-9 h-9 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="ml-6">
              <p className="text-caption text-neutral-500 mb-3 font-semibold">Total Users</p>
              <p className="text-heading-2 font-bold text-neutral-900">{data.totalUsers}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
          <div className="flex items-center">
            <div className="p-5 bg-gradient-to-br from-error-100 to-error-200 rounded-2xl shadow-lg shadow-error-500/20 hover:scale-110 transition-transform duration-300">
              <svg className="w-9 h-9 text-error-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div className="ml-6">
              <p className="text-caption text-neutral-500 mb-3 font-semibold">Total Products</p>
              <p className="text-heading-2 font-bold text-neutral-900">{data.totalProducts}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced Monthly Summary */}
      <div className="card-elevated p-10 hover:scale-[1.01] transition-all duration-300">
        <h2 className="text-heading-2 font-bold text-neutral-900 mb-10">This Month's Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-10 bg-gradient-to-br from-success-50 via-white to-success-100 rounded-2xl border border-success-200/60 shadow-lg shadow-success-500/10 hover:shadow-xl hover:shadow-success-500/20 transition-all duration-300 hover:scale-[1.02]">
            <div className="w-20 h-20 bg-gradient-to-br from-success-500 to-success-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-success-500/30 hover:scale-110 transition-transform duration-300">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <p className="text-caption text-success-600 mb-4 font-bold">Total Sales</p>
            <p className="text-heading-1 font-bold text-success-700">{formatCurrency(data.month.sales)}</p>
          </div>
          <div className="text-center p-10 bg-gradient-to-br from-primary-50 via-white to-primary-100 rounded-2xl border border-primary-200/60 shadow-lg shadow-primary-500/10 hover:shadow-xl hover:shadow-primary-500/20 transition-all duration-300 hover:scale-[1.02]">
            <div className="w-20 h-20 bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary-500/30 hover:scale-110 transition-transform duration-300">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-caption text-primary-600 mb-4 font-bold">Total Orders</p>
            <p className="text-heading-1 font-bold text-primary-700">{data.month.orders}</p>
          </div>
          <div className="text-center p-10 bg-gradient-to-br from-warning-50 via-white to-warning-100 rounded-2xl border border-warning-200/60 shadow-lg shadow-warning-500/10 hover:shadow-xl hover:shadow-warning-500/20 transition-all duration-300 hover:scale-[1.02]">
            <div className="w-20 h-20 bg-gradient-to-br from-warning-500 to-warning-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-warning-500/30 hover:scale-110 transition-transform duration-300">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-caption text-warning-600 mb-4 font-bold">Average Order Value</p>
            <p className="text-heading-1 font-bold text-warning-700">{formatCurrency(data.month.averageOrderValue)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Enhanced Recent Orders */}
        <div className="card-elevated p-10 hover:scale-[1.01] transition-all duration-300">
          <h2 className="text-heading-2 font-bold text-neutral-900 mb-10">Recent Orders</h2>
          <div className="space-y-6">
            {data.recentOrders.map((order) => (
              <div key={order._id} className="flex items-center justify-between p-6 bg-gradient-to-r from-neutral-50 via-white to-neutral-50 rounded-2xl border border-neutral-200/60 transition-all duration-300 hover:bg-gradient-to-r hover:from-neutral-100 hover:via-white hover:to-neutral-100 hover:shadow-lg hover:shadow-neutral-900/5 hover:scale-[1.02]">
                <div>
                  <p className="font-bold text-neutral-900 text-lg mb-2">{order.userId.name}</p>
                  <p className="text-body-small text-neutral-600 font-medium mb-1">{order.userId.email}</p>
                  <p className="text-caption text-neutral-500 font-semibold">{formatDate(order.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-neutral-900 text-lg mb-2">{formatCurrency(order.total)}</p>
                  <span className={`badge ${
                    order.orderStatus === 'Delivered' ? 'badge-success' :
                    order.orderStatus === 'Cancelled' ? 'badge-error' :
                    'badge-warning'
                  }`}>
                    {order.orderStatus}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Enhanced Low Stock Alerts */}
        <div className="card-elevated p-10 hover:scale-[1.01] transition-all duration-300">
          <h2 className="text-heading-2 font-bold text-neutral-900 mb-10">Low Stock Alerts</h2>
          <div className="space-y-6">
            {data.lowStockProducts.length > 0 ? (
              data.lowStockProducts.map((product) => (
                <div key={product._id} className="flex items-center justify-between p-6 bg-gradient-to-r from-error-50 via-white to-error-50 rounded-2xl border border-error-200/60 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all duration-300">
                  <div>
                    <p className="font-bold text-neutral-900 text-lg mb-2">{product.name}</p>
                    <p className="text-body-small text-error-600 font-semibold">Low stock warning</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-error-600 text-lg mb-2">{product.stockQuantity} left</p>
                    <div className="w-3 h-3 bg-error-500 rounded-full animate-pulse mx-auto"></div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-20">
                <div className="w-24 h-24 bg-gradient-to-br from-success-100 to-success-200 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-success-500/20 hover:scale-110 transition-transform duration-300">
                  <svg className="w-12 h-12 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-neutral-900 font-bold text-xl mb-3">All products have sufficient stock</p>
                <p className="text-caption text-neutral-500 font-semibold">Great job managing inventory!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard; 