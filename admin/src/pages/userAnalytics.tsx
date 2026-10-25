import React, { useCallback, useEffect, useState } from 'react';
import { backendUrl } from '../config';

interface ActivityBreakdown {
  _id: string;
  count: number;
}

interface DailyActivity {
  _id: string;
  count: number;
}

interface ActiveUser {
  userId: string;
  name: string;
  email: string;
  activityCount: number;
}

interface ProductInteraction {
  _id: string;
  views: number;
  addToCart: number;
  purchases: number;
  product: {
    _id: string;
    name: string;
    price: number;
    image: string[];
    category: string;
  };
}

interface UserBehaviorData {
  activityBreakdown: ActivityBreakdown[];
  dailyActivity: DailyActivity[];
  activeUsers: ActiveUser[];
  productInteractions: ProductInteraction[];
  period: {
    start: string;
    end: string;
  };
}

const UserAnalytics: React.FC = () => {
  const [data, setData] = useState<UserBehaviorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const [userId, setUserId] = useState('');

  const fetchUserData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });

      if (userId) {
        params.append('userId', userId);
      }

      const response = await fetch(`${backendUrl}/api/analytics/user-behavior?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user behavior data');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [dateRange, userId]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'login':
        return 'Login';
      case 'logout':
        return 'Logout';
      case 'view_product':
        return 'View Product';
      case 'add_to_cart':
        return 'Add to Cart';
      case 'remove_from_cart':
        return 'Remove from Cart';
      case 'purchase':
        return 'Purchase';
      case 'search':
        return 'Search';
      case 'filter':
        return 'Filter';
      default:
        return action;
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'login':
        return 'bg-green-100 text-green-800';
      case 'logout':
        return 'bg-red-100 text-red-800';
      case 'view_product':
        return 'bg-blue-100 text-blue-800';
      case 'add_to_cart':
        return 'bg-yellow-100 text-yellow-800';
      case 'remove_from_cart':
        return 'bg-orange-100 text-orange-800';
      case 'purchase':
        return 'bg-purple-100 text-purple-800';
      case 'search':
        return 'bg-indigo-100 text-indigo-800';
      case 'filter':
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
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
        <h1 className="text-3xl font-bold text-gray-900">User Behavior Analytics</h1>
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
            <label className="block text-sm font-medium text-gray-700">User ID (Optional)</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Filter by user ID"
              className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
         onClick={fetchUserData}
          className="btn-modern btn-secondary hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700 group px-8 py-4 hover:scale-105 transition-all duration-300"
        >
          <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
       
        </button>
        
        </div>
      </div>

      {/* Activity Breakdown */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Activity Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.activityBreakdown.map((activity) => (
            <div key={activity._id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getActionColor(activity._id)}`}>
                  {getActionLabel(activity._id)}
                </span>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-gray-900">{formatNumber(activity.count)}</p>
                <p className="text-sm text-gray-600">activities</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Activity Trend */}
        <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Daily Activity Trend</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.dailyActivity.map((day) => (
              <div key={day._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{formatDate(day._id)}</p>
                  <p className="text-sm text-gray-600">Daily activities</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">{formatNumber(day.count)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Most Active Users */}
        <div className=" card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Most Active Users</h2>
          <div className="space-y-3">
            {data.activeUsers.map((user, index) => (
              <div key={user.userId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    <span className="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
                      {index + 1}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{user.name}</p>
                    <p className="text-sm text-gray-600">{user.email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">{formatNumber(user.activityCount)}</p>
                  <p className="text-sm text-gray-600">activities</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Product Interactions */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Product Interaction Analytics</h2>
        <div className="space-y-4">
          {data.productInteractions.map((interaction, index) => (
            <div key={interaction._id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center justify-center w-8 h-8 bg-green-100 text-green-800 text-sm font-semibold rounded-full">
                    {index + 1}
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <img
                    src={interaction.product.image[0]}
                    alt={interaction.product.name}
                    className="w-12 h-12 object-cover rounded-lg"
                  />
                  <div>
                    <p className="font-medium text-gray-900">{interaction.product.name}</p>
                    <p className="text-sm text-gray-600">{interaction.product.category}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-lg font-bold text-blue-600">{formatNumber(interaction.views)}</p>
                    <p className="text-sm text-gray-600">Views</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-yellow-600">{formatNumber(interaction.addToCart)}</p>
                    <p className="text-sm text-gray-600">Add to Cart</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-green-600">{formatNumber(interaction.purchases)}</p>
                    <p className="text-sm text-gray-600">Purchases</p>
                  </div>
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  Conversion: {interaction.views > 0 ? ((interaction.purchases / interaction.views) * 100).toFixed(2) : 0}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="card-elevated card-modern bg-white p-6 rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Summary Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-600">
              {formatNumber(data.activityBreakdown.reduce((sum, activity) => sum + activity.count, 0))}
            </p>
            <p className="text-gray-600">Total Activities</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">
              {formatNumber(data.activeUsers.length)}
            </p>
            <p className="text-gray-600">Active Users</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-purple-600">
              {formatNumber(data.productInteractions.length)}
            </p>
            <p className="text-gray-600">Products with Interactions</p>
          </div>
        </div>
      </div>

      {/* Period Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-blue-800">
          <strong>Period:</strong> {formatDate(data.period.start)} to {formatDate(data.period.end)}
          {userId && (
            <span className="ml-4">
              <strong>Filtered by User ID:</strong> {userId}
            </span>
          )}
        </p>
      </div>
    </div>
  );
};

export default UserAnalytics; 