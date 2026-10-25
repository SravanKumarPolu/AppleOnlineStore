import React, { useCallback, useEffect, useState } from 'react';
import { backendUrl } from '../config';

interface PopularSearch {
  _id: string;
  query: string;
  count: number;
  resultsCount: number;
  category?: string;
  date: string;
}

interface SearchTrend {
  _id: string;
  totalSearches: number;
  uniqueQueries: number;
}

interface CategorySearch {
  _id: string;
  totalSearches: number;
  uniqueQueries: number;
}

interface SearchStats {
  totalSearches: number;
  uniqueQueries: number;
  averageResults: number;
}

interface SearchAnalyticsData {
  popularSearches: PopularSearch[];
  searchTrends: SearchTrend[];
  categorySearches: CategorySearch[];
  searchStats: SearchStats;
  period: {
    start: string;
    end: string;
  };
}

const SearchAnalytics: React.FC = () => {
  const [data, setData] = useState<SearchAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [limit, setLimit] = useState(10);

  const fetchSearchData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        limit: limit.toString()
      });

      const response = await fetch(`${backendUrl}/api/analytics/search?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch search data');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [dateRange, limit]);

  useEffect(() => {
    fetchSearchData();
  }, [fetchSearchData]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const getCategoryColor = (category: string) => {
    const colors = [
      'bg-blue-100 text-blue-800',
      'bg-green-100 text-green-800',
      'bg-yellow-100 text-yellow-800',
      'bg-purple-100 text-purple-800',
      'bg-pink-100 text-pink-800',
      'bg-indigo-100 text-indigo-800',
      'bg-red-100 text-red-800',
      'bg-orange-100 text-orange-800'
    ];
    const index = category.charCodeAt(0) % colors.length;
    return colors[index];
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
        <h1 className="text-3xl font-bold text-gray-900">Search Analytics</h1>
        <div className="flex items-center space-x-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Start Date</label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End Date</label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Top Searches</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
          </div>
        
          <button
        onClick={fetchSearchData}
          className="btn-modern btn-secondary hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 group px-8 py-4 hover:scale-105 transition-all duration-300"
        >
          <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="font-semibold">Refresh</span>
        </button>

        </div>
      </div>

      {/* Search Statistics */}
      <div className=" grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Searches</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(data.searchStats.totalSearches)}</p>
            </div>
          </div>
        </div>

        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Unique Queries</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(data.searchStats.uniqueQueries)}</p>
            </div>
          </div>
        </div>

        <div className=" card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg Results</p>
              <p className="text-2xl font-bold text-gray-900">{data.searchStats.averageResults.toFixed(1)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Popular Searches */}
        <div className="card-elevated card-modernbg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Popular Searches</h2>
          <div className="space-y-3">
            {data.popularSearches.map((search, index) => (
              <div key={search._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
                      {index + 1}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">"{search.query}"</p>
                    <div className="flex items-center space-x-2">
                      <p className="text-sm text-gray-600">{search.resultsCount} results</p>
                      {search.category && (
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getCategoryColor(search.category)}`}>
                          {search.category}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">{formatNumber(search.count)}</p>
                  <p className="text-sm text-gray-600">searches</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Search Trends */}
        <div className="card-elevated card-modernbg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Search Trends</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.searchTrends.map((trend) => (
              <div key={trend._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{formatDate(trend._id)}</p>
                  <p className="text-sm text-gray-600">Daily search activity</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">{formatNumber(trend.totalSearches)}</p>
                  <p className="text-sm text-gray-600">{formatNumber(trend.uniqueQueries)} unique</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category Search Breakdown */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Search by Category</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.categorySearches.map((category) => (
            <div key={category._id} className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{category._id}</h3>
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getCategoryColor(category._id)}`}>
                  {category._id}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total Searches:</span>
                  <span className="text-sm font-medium">{formatNumber(category.totalSearches)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Unique Queries:</span>
                  <span className="text-sm font-medium">{formatNumber(category.uniqueQueries)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Avg Searches per Query:</span>
                  <span className="text-sm font-medium">
                    {category.uniqueQueries > 0 ? (category.totalSearches / category.uniqueQueries).toFixed(1) : 0}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search Performance Metrics */}
      <div className="card-elevated card-modernbg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Search Performance Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-600">
              {data.searchStats.totalSearches > 0 ? (data.searchStats.uniqueQueries / data.searchStats.totalSearches * 100).toFixed(1) : 0}%
            </p>
            <p className="text-gray-600">Query Diversity</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">
              {data.searchStats.averageResults.toFixed(1)}
            </p>
            <p className="text-gray-600">Avg Results per Search</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-purple-600">
              {data.searchStats.totalSearches > 0 ? (data.searchStats.totalSearches / data.searchStats.uniqueQueries).toFixed(1) : 0}
            </p>
            <p className="text-gray-600">Searches per Query</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-orange-600">
              {data.popularSearches.length > 0 ? data.popularSearches[0].count : 0}
            </p>
            <p className="text-gray-600">Most Popular Search</p>
          </div>
        </div>
      </div>

      {/* Search Insights */}
      <div className="card-elevated card-modernbg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Search Insights</h2>
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Search Volume</p>
              <p className="text-sm text-gray-600">
                {formatNumber(data.searchStats.totalSearches)} total searches with {formatNumber(data.searchStats.uniqueQueries)} unique queries
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Search Results</p>
              <p className="text-sm text-gray-600">
                Average of {data.searchStats.averageResults.toFixed(1)} results per search query
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Top Search</p>
              <p className="text-sm text-gray-600">
                "{data.popularSearches.length > 0 ? data.popularSearches[0].query : 'No searches'}" with {data.popularSearches.length > 0 ? formatNumber(data.popularSearches[0].count) : 0} searches
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Period Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-blue-800">
          <strong>Period:</strong> {formatDate(data.period.start)} to {formatDate(data.period.end)}
        </p>
      </div>
    </div>
  );
};

export default SearchAnalytics; 