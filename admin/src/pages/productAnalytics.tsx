import React, { useCallback, useEffect, useState } from 'react';
import { backendUrl, currency } from '../config';

interface TopProduct {
  _id: string;
  productId: {
    _id: string;
    name: string;
    price: number;
    image: string[];
    category: string;
    subCategory: string;
  };
  views: number;
  addToCartCount: number;
  purchaseCount: number;
  revenue: number;
  conversionRate: number;
}

interface ProductStats {
  totalViews: number;
  totalAddToCart: number;
  totalPurchases: number;
  totalRevenue: number;
  averageConversionRate: number;
}

interface CategoryPerformance {
  _id: string;
  totalViews: number;
  totalAddToCart: number;
  totalPurchases: number;
  totalRevenue: number;
  productCount: number;
}

interface ProductAnalyticsData {
  topProducts: TopProduct[];
  productStats: ProductStats;
  categoryPerformance: CategoryPerformance[];
}

const ProductAnalytics: React.FC = () => {
  const [data, setData] = useState<ProductAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState('revenue');
  const [limit, setLimit] = useState(10);
  const [category, setCategory] = useState('');

  const fetchProductData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        metric,
        limit: limit.toString()
      });

      if (category) {
        params.append('category', category);
      }

      const response = await fetch(`${backendUrl}/api/analytics/products?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch product data');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [metric, limit, category]);

  useEffect(() => {
    fetchProductData();
  }, [fetchProductData]);

  const formatCurrency = (amount: number) => {
    return `${currency}${amount.toFixed(2)}`;
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatPercentage = (num: number) => {
    return `${(num * 100).toFixed(2)}%`;
  };

  const getMetricLabel = (metric: string) => {
    switch (metric) {
      case 'revenue':
        return 'Revenue';
      case 'views':
        return 'Views';
      case 'addToCartCount':
        return 'Add to Cart';
      case 'purchaseCount':
        return 'Purchases';
      default:
        return 'Revenue';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error: {error}</p>
      </div>
    );
  }

  if (!data) {
    return <div>No data available</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Product Performance Analytics</h1>
        <button
       onClick={fetchProductData}
          className="btn-modern btn-secondary hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 group px-8 py-4 hover:scale-105 transition-all duration-300"
        >
          <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="font-semibold">Refresh</span>
        </button>
      
      </div>

      {/* Filters */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <div className=" grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sort by Metric</label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="revenue">Revenue</option>
              <option value="views">Views</option>
              <option value="addToCartCount">Add to Cart</option>
              <option value="purchaseCount">Purchases</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Number of Products</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category Filter</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              <option value="iPhone">iPhone</option>
              <option value="iPad">iPad</option>
              <option value="Mac">Mac</option>
              <option value="Watch">Watch</option>
              <option value="AirPods">AirPods</option>
              <option value="Accessories">Accessories</option>
            </select>
          </div>
        </div>
      </div>

      {/* Product Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Views</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(data.productStats.totalViews)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-2.5 5M7 13l2.5 5m6-5v6a2 2 0 01-2 2H9a2 2 0 01-2-2v-6m6 0V9a2 2 0 00-2-2H9a2 2 0 00-2 2v4.01" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Add to Cart</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(data.productStats.totalAddToCart)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Purchases</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(data.productStats.totalPurchases)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.productStats.totalRevenue)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg Conversion</p>
              <p className="text-2xl font-bold text-gray-900">{formatPercentage(data.productStats.averageConversionRate)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top Products */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Top Products by {getMetricLabel(metric)}</h2>
        <div className="space-y-4">
          {data.topProducts
            .filter(product => product.productId && product.productId.name) // Filter out products with null productId
            .map((product, index) => (
            <div key={product._id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
                    {index + 1}
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <img
                    src={product.productId?.image?.[0] || '/placeholder-image.svg'}
                    alt={product.productId?.name || 'Product'}
                    className="w-12 h-12 object-cover rounded-lg"
                    onError={(e) => {
                      e.currentTarget.src = '/placeholder-image.svg';
                    }}
                  />
                  <div>
                    <p className="font-medium text-gray-900">{product.productId?.name || 'Unknown Product'}</p>
                    <p className="text-sm text-gray-600">
                      {product.productId?.category || 'Unknown'} • {product.productId?.subCategory || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-500">{formatCurrency(product.productId?.price || 0)}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">
                  {metric === 'revenue' ? formatCurrency(product.revenue) :
                   metric === 'views' ? formatNumber(product.views) :
                   metric === 'addToCartCount' ? formatNumber(product.addToCartCount) :
                   formatNumber(product.purchaseCount)}
                </p>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>Views: {formatNumber(product.views)}</p>
                  <p>Add to Cart: {formatNumber(product.addToCartCount)}</p>
                  <p>Purchases: {formatNumber(product.purchaseCount)}</p>
                  <p>Conversion: {formatPercentage(product.conversionRate)}</p>
                </div>
              </div>
            </div>
          ))}
          {data.topProducts.filter(product => product.productId && product.productId.name).length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500">No product performance data available</p>
            </div>
          )}
        </div>
      </div>

      {/* Category Performance */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Category Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.categoryPerformance.map((category) => (
            <div key={category._id} className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{category._id}</h3>
                <span className="text-sm text-gray-600">{category.productCount} products</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Views:</span>
                  <span className="text-sm font-medium">{formatNumber(category.totalViews)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Add to Cart:</span>
                  <span className="text-sm font-medium">{formatNumber(category.totalAddToCart)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Purchases:</span>
                  <span className="text-sm font-medium">{formatNumber(category.totalPurchases)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Revenue:</span>
                  <span className="text-sm font-medium">{formatCurrency(category.totalRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Conversion:</span>
                  <span className="text-sm font-medium">
                    {formatPercentage(category.totalViews > 0 ? category.totalPurchases / category.totalViews : 0)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProductAnalytics; 