import React, { useCallback, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { backendUrl } from '../config';
import { toast } from 'react-toastify';
import { getApiErrorMessage, getAxiosErrorResponse, isNetworkError } from '../apiTypes';
import { useRealtime } from '../context/realtime-context';
import { useRealtimeEvent } from '../hooks/useRealtimeEvent';

interface OrderItem {
  productId: string;
  name: string;
  image: string;
  price: number;
  quantity: number;
  color: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
}

interface Order {
  _id: string;
  user: User;
  items: OrderItem[];
  address: {
    firstName: string;
    lastName: string;
    email: string;
    street: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    phone: string;
  };
  paymentMethod: string;
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  orderStatus: 'Order Placed' | 'Packing' | 'Shipped' | 'Out for delivery' | 'Delivered' | 'Cancelled';
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalTransactionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface OrdersResponse {
  success: boolean;
  orders: Order[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalOrders: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    limit: number;
  };
  filters: {
    users: Array<{ _id: string; name: string; email: string }>;
    orderStatuses: string[];
    paymentStatuses: string[];
  };
  stats: {
    totalOrders: number;
    totalRevenue: number;
    pendingOrders: number;
    completedOrders: number;
    pendingPayments: number;
    completedPayments: number;
  };
}

type OrdersStats = OrdersResponse['stats'];
type OrdersPagination = OrdersResponse['pagination'];
type OrdersFilters = OrdersResponse['filters'];

interface OrdersProps {
  token: string;
}

/** Shape of the realtime order payload (backend services/socketService.js). */
interface RealtimeOrderEvent {
  _id?: string;
  eventId?: string;
  type?: 'order_created' | 'order_updated' | 'payment_update';
  orderStatus?: string | null;
  paymentStatus?: string | null;
  refundStatus?: string | null;
  updatedAt?: string | null;
}

const Orders: React.FC<OrdersProps> = ({ token }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OrdersStats | null>(null);
  const [pagination, setPagination] = useState<OrdersPagination | null>(null);
  const [filters, setFilters] = useState<OrdersFilters | null>(null);
  
  // Filter states
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<string>('desc');

  // Realtime: the provider owns the single admin socket. Without it (unit
  // tests, socket unavailable) the getters default to a disconnected state and
  // every subscription below is a no-op.
  const realtime = useRealtime();

  // Latest list/params without re-subscribing on each render.
  const ordersRef = useRef<Order[]>(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const fetchOrders = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      // A realtime refresh must not blank the table behind a full-page spinner.
      if (!silent) setLoading(true);

      // Check if token exists
      if (!token) {
        toast.error('No authentication token found. Please login again.');
        return;
      }

      // Build query parameters
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
        sortBy,
        sortOrder
      });

      if (selectedStatus) params.append('status', selectedStatus);
      if (selectedPaymentStatus) params.append('paymentStatus', selectedPaymentStatus);
      if (userEmail) params.append('userEmail', userEmail);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      // SECURITY FIX: never log token material, even truncated.
      console.log('🔍 Request URL:', `${backendUrl}/api/orders/all?${params}`);

      const response = await axios.get<OrdersResponse>(`${backendUrl}/api/orders/all?${params}`, {
        headers: { token }
      });

      if (response.data.success) {
        setOrders(response.data.orders);
        setPagination(response.data.pagination);
        setFilters(response.data.filters);
        setStats(response.data.stats);
      } else {
        toast.error('Failed to fetch orders');
      }
    } catch (error) {
      console.error('Error fetching orders:', error);

      // Handle specific error cases
      const responseError = getAxiosErrorResponse(error);
      if (responseError) {
        const { status, data } = responseError;

        if (status === 401) {
          toast.error('Authentication failed. Please login again.');
          console.error('401 Error Details:', data);
        } else if (status === 403) {
          toast.error('Access denied. Admin privileges required.');
        } else {
          toast.error(data?.message || 'Failed to fetch orders');
        }
      } else if (isNetworkError(error)) {
        toast.error('Network error. Please check your connection.');
      } else {
        toast.error(getApiErrorMessage(error, 'Failed to fetch orders'));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token, currentPage, sortBy, sortOrder, selectedStatus, selectedPaymentStatus, userEmail, startDate, endDate]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ---------------------------------------------------------------------
  // Live order feed. Existing rows are patched in place (status badges flip
  // immediately); anything else schedules ONE debounced silent refresh so the
  // list, stats and pagination stay consistent without polling.
  // ---------------------------------------------------------------------
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSilentRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      fetchOrders({ silent: true });
    }, 600);
  }, [fetchOrders]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  const applyRealtimeOrder = useCallback(
    (payload: RealtimeOrderEvent) => {
      const id = String(payload?._id ?? '');
      if (!id) return;

      const current = ordersRef.current.find((order) => order._id === id);
      if (!current) {
        // A new/changed order may belong anywhere in the filtered, sorted,
        // paginated view — let the API decide.
        scheduleSilentRefresh();
        return;
      }

      const nextStatus = (payload.orderStatus as Order['orderStatus']) ?? current.orderStatus;
      const nextPayment =
        (payload.paymentStatus as Order['paymentStatus']) ?? current.paymentStatus;
      const nextUpdated = payload.updatedAt ?? current.updatedAt;

      // Nothing visible changed: no re-render and no extra request. This is
      // what keeps a reconnect replay (or a duplicate delivery) from causing
      // a request storm.
      if (
        nextStatus === current.orderStatus &&
        nextPayment === current.paymentStatus &&
        nextUpdated === current.updatedAt
      ) {
        return;
      }

      setOrders((previous) =>
        previous.map((order) =>
          order._id === id
            ? { ...order, orderStatus: nextStatus, paymentStatus: nextPayment, updatedAt: nextUpdated }
            : order
        )
      );

      // Counters (pending/completed orders, revenue) are derived server-side, so
      // one debounced refresh keeps them honest.
      scheduleSilentRefresh();
    },
    [scheduleSilentRefresh]
  );

  useRealtimeEvent<RealtimeOrderEvent>(realtime.socket, 'order_updated', applyRealtimeOrder);
  useRealtimeEvent<RealtimeOrderEvent>(realtime.socket, 'new_order', applyRealtimeOrder);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const response = await axios.put(`${backendUrl}/api/orders/status`, {
        orderId,
        status: newStatus
      }, {
        headers: { token }
      });

      if (response.data.success) {
        toast.success('Order status updated successfully');
        if (!realtime.isConnected) fetchOrders();
      } else {
        toast.error('Failed to update order status');
      }
    } catch (error) {
      console.error('Error updating order status:', error);
      toast.error('Failed to update order status');
    }
  };

  const clearFilters = () => {
    setSelectedStatus('');
    setSelectedPaymentStatus('');
    setStartDate('');
    setEndDate('');
    setUserEmail('');
    setCurrentPage(1);
    setSortBy('createdAt');
    setSortOrder('desc');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Order Placed':
        return 'badge-info';
      case 'Packing':
        return 'badge-warning';
      case 'Shipped':
        return 'badge-info';
      case 'Out for delivery':
        return 'badge-warning';
      case 'Delivered':
        return 'badge-success';
      case 'Cancelled':
        return 'badge-error';
      default:
        return 'badge';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'pending':
        return 'badge-warning';
      case 'failed':
        return 'badge-error';
      case 'refunded':
        return 'badge';
      default:
        return 'badge';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-8"></div>
          <p className="text-neutral-600 font-semibold text-lg mb-2">Loading orders...</p>
          <p className="text-caption text-neutral-500">Please wait while we fetch your order data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {/* Enhanced Header with Stats */}
      <div className="card-elevated p-10 hover:scale-[1.01] transition-all duration-300">
        <div className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-heading-1 font-bold gradient-text mb-4">Order Management</h1>
            <p className="text-body-large text-neutral-600 font-medium">Manage and track all customer orders</p>
            {/* Operators must be able to tell a live feed from a stale one. */}
            <p
              role="status"
              aria-live="polite"
              className={`mt-3 inline-flex items-center gap-2 text-body-small font-semibold ${
                realtime.isConnected
                  ? 'text-success-700'
                  : realtime.connectionError
                    ? 'text-error-700'
                    : 'text-neutral-500'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 rounded-full ${
                  realtime.isConnected
                    ? 'bg-success-500'
                    : realtime.connectionError
                      ? 'bg-error-500'
                      : 'bg-neutral-400'
                }`}
              />
              {realtime.isConnected
                ? 'Live updates on'
                : realtime.connectionError
                  ? 'Live updates offline'
                  : 'Connecting to live updates…'}
              {!realtime.isConnected && !realtime.authError && (
                <button
                  type="button"
                  onClick={realtime.reconnect}
                  className="ml-2 underline underline-offset-2"
                >
                  Reconnect
                </button>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-caption text-neutral-500 font-semibold mb-2">Total Orders</p>
            <p className="text-heading-2 font-bold text-neutral-900">{stats?.totalOrders || 0}</p>
          </div>
        </div>
        
        {/* Enhanced Statistics Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="card-modern p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
              <div className="flex items-center">
                <div className="p-5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-2xl shadow-lg shadow-primary-500/20 hover:scale-110 transition-transform duration-300">
                  <svg className="w-9 h-9 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
                <div className="ml-6 flex-1 min-w-0">
                  <p className="text-caption text-neutral-500 mb-3 font-semibold">Total Revenue</p>
  
                  <div className="relative">
  <div
    className="tooltip tooltip-top z-50   "
    data-tip={formatCurrency(stats.totalRevenue)}
  >
    <p className="text-heading-2 font-bold text-neutral-900 cursor-pointer hover:opacity-80">
      {formatCurrency(stats.totalRevenue)}
    </p>
  </div>
</div>



                </div>
              </div>
            </div>
            <div className="card-modern p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
              <div className="flex items-center">
                <div className="p-5 bg-gradient-to-br from-warning-100 to-warning-200 rounded-2xl shadow-lg shadow-warning-500/20 hover:scale-110 transition-transform duration-300">
                  <svg className="w-9 h-9 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-6">
                  <p className="text-caption text-neutral-500 mb-3 font-semibold">Pending Orders</p>
                  <p className="text-heading-2 font-bold text-neutral-900">{stats.pendingOrders}</p>
                </div>
              </div>
            </div>
            <div className="card-modern p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
              <div className="flex items-center">
                <div className="p-5 bg-gradient-to-br from-success-100 to-success-200 rounded-2xl shadow-lg shadow-success-500/20 hover:scale-110 transition-transform duration-300">
                  <svg className="w-9 h-9 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-6">
                  <p className="text-caption text-neutral-500 mb-3 font-semibold">Completed Orders</p>
                  <p className="text-heading-2 font-bold text-neutral-900">{stats.completedOrders}</p>
                </div>
              </div>
            </div>
            <div className="card-modern p-8 hover-lift hover:scale-[1.02] transition-all duration-300">
              <div className="flex items-center">
                <div className="p-5 bg-gradient-to-br from-error-100 to-error-200 rounded-2xl shadow-lg shadow-error-500/20 hover:scale-110 transition-transform duration-300">
                  <svg className="w-9 h-9 text-error-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-6">
                  <p className="text-caption text-neutral-500 mb-3 font-semibold">Pending Payments</p>
                  <p className="text-heading-2 font-bold text-neutral-900">{stats.pendingPayments}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Advanced Filters */}
      <div className="card-elevated p-10 hover:scale-[1.01] transition-all duration-300">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-heading-2 font-bold text-neutral-900">Filters</h2>
          <button
            onClick={clearFilters}
            className="btn-modern btn-ghost hover:bg-error-50 hover:border-error-200 hover:text-error-700 hover:scale-105 transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="font-semibold">Clear All Filters</span>
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {/* Order Status Filter */}
          <div className="form-group">
            <label className="form-label">Order Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="select-modern hover:scale-[1.02] transition-transform duration-300"
            >
              <option value="">All Statuses</option>
              {filters?.orderStatuses.map((status: string) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          {/* Payment Status Filter */}
          <div className="form-group">
            <label className="form-label">Payment Status</label>
            <select
              value={selectedPaymentStatus}
              onChange={(e) => setSelectedPaymentStatus(e.target.value)}
              className="select-modern hover:scale-[1.02] transition-transform duration-300"
            >
              <option value="">All Payment Statuses</option>
              {filters?.paymentStatuses.map((status: string) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          {/* User Email Filter */}
          <div className="form-group">
            <label className="form-label">User Email</label>
            <input
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="Filter by user email"
              className="input-modern hover:scale-[1.02] transition-transform duration-300"
            />
          </div>

          {/* Sort By */}
          <div className="form-group">
            <label className="form-label">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="select-modern hover:scale-[1.02] transition-transform duration-300"
            >
              <option value="createdAt">Date Created</option>
              <option value="total">Order Total</option>
              <option value="orderStatus">Order Status</option>
              <option value="paymentStatus">Payment Status</option>
            </select>
          </div>

          {/* Sort Order */}
          <div className="form-group">
            <label className="form-label">Sort Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="select-modern hover:scale-[1.02] transition-transform duration-300"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>

          {/* Date Range */}
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-modern hover:scale-[1.02] transition-transform duration-300"
            />
          </div>

          <div className="form-group">
            <label className="form-label">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-modern hover:scale-[1.02] transition-transform duration-300"
            />
          </div>
        </div>
      </div>

      {/* Enhanced Pagination Info */}
      {pagination && (
        <div className="flex justify-between items-center p-6 bg-gradient-to-r from-neutral-50 via-white to-neutral-50 rounded-2xl border border-neutral-200/60 shadow-sm hover:shadow-md transition-all duration-300">
          <div className="text-body-small text-neutral-600 font-medium">
            Showing {((pagination.currentPage - 1) * pagination.limit) + 1} to {Math.min(pagination.currentPage * pagination.limit, pagination.totalOrders)} of {pagination.totalOrders} orders
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setCurrentPage(pagination.currentPage - 1)}
              disabled={!pagination.hasPrevPage}
              className="btn-modern btn-secondary disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-all duration-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Previous</span>
            </button>
            <span className="px-4 py-2 bg-neutral-100 rounded-lg text-sm font-semibold text-neutral-700 flex items-center">
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(pagination.currentPage + 1)}
              disabled={!pagination.hasNextPage}
              className="btn-modern btn-secondary disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 transition-all duration-300"
            >
              <span>Next</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Enhanced Orders List */}
      {orders.length === 0 ? (
        <div className="card-elevated p-16 text-center hover:scale-[1.01] transition-all duration-300">
          <div className="w-24 h-24 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-8 hover:scale-110 transition-transform duration-300">
            <svg className="w-12 h-12 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-heading-3 font-bold text-neutral-900 mb-4">No orders found</h3>
          <p className="text-body text-neutral-500">There are no orders matching your filters.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {orders.map((order) => (
            <div key={order._id} className="card-elevated overflow-hidden hover:scale-[1.01] transition-all duration-300">
              {/* Enhanced Order Header */}
              <div className="bg-gradient-to-r from-neutral-50 via-white to-neutral-50 px-8 py-6 border-b border-neutral-200/60">
                <div className="flex flex-wrap justify-between items-start gap-6">
                  <div className="flex-1">
                    <h3 className="text-heading-3 font-bold text-neutral-900 mb-2">
                      Order #{order._id.slice(-8).toUpperCase()}
                    </h3>
                    <p className="text-body-small text-neutral-600 mb-3">
                      Placed on {formatDate(order.createdAt)}
                    </p>
                    {order.user && (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <p className="text-body-small text-neutral-600 font-medium">
                          {order.user.name} ({order.user.email})
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <span className={`badge ${getStatusColor(order.orderStatus)}`}>
                      {order.orderStatus}
                    </span>
                    <span className={`badge ${getPaymentStatusColor(order.paymentStatus)}`}>
                      {order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Enhanced Order Items */}
              <div className="p-8">
                <div className="space-y-6">
                  {order.items.map((item, index) => (
                    <div key={index} className="flex items-center gap-6 p-6 bg-gradient-to-r from-neutral-50 via-white to-neutral-50 rounded-2xl border border-neutral-200/60 hover:shadow-md hover:scale-[1.02] transition-all duration-300">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-20 h-20 object-cover rounded-xl shadow-sm hover:scale-110 transition-transform duration-300"
                      />
                      <div className="flex-1">
                        <h4 className="font-bold text-neutral-900 text-lg mb-2">{item.name}</h4>
                        <p className="text-body-small text-neutral-600 mb-2">
                          Color: {item.color} | Quantity: {item.quantity}
                        </p>
                        <p className="text-body font-semibold text-neutral-900 break-words">
                          {formatCurrency(item.price)} each
                        </p>
                      </div>
                      <div className="text-right">
                        <div 
                          className="tooltip" 
                          data-tip={formatCurrency(item.price * item.quantity)}
                        >
                          <p className="text-heading-3 font-bold text-neutral-900 break-words leading-tight min-w-0">
                            {formatCurrency(item.price * item.quantity)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Enhanced Order Summary */}
                <div className="mt-8 pt-8 border-t border-neutral-200/60">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-body text-neutral-600">Subtotal:</span>
                    <span className="text-body font-semibold break-words">{formatCurrency(order.subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-body text-neutral-600">Shipping:</span>
                    <span className="text-body font-semibold break-words">{formatCurrency(order.shipping)}</span>
                  </div>
                  <div className="flex justify-between items-center text-heading-2 font-bold border-t border-neutral-200/60 pt-4">
                    <span>Total:</span>
                    <div 
                      className="tooltip" 
                      data-tip={formatCurrency(order.total)}
                    >
                      <span className="break-words leading-tight min-w-0">{formatCurrency(order.total)}</span>
                    </div>
                  </div>
                </div>

                {/* Enhanced Payment and Shipping Info */}
                <div className="mt-8 pt-8 border-t border-neutral-200/60 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="card-modern p-6 hover:scale-[1.02] transition-all duration-300">
                    <h4 className="font-bold text-neutral-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Shipping Address
                    </h4>
                    <div className="text-body-small text-neutral-600 space-y-1">
                      <p className="font-semibold">{order.address.firstName} {order.address.lastName}</p>
                      <p>{order.address.street}</p>
                      <p>{order.address.city}, {order.address.state} {order.address.zipcode}</p>
                      <p>{order.address.country}</p>
                      <p className="mt-2 font-medium">Phone: {order.address.phone}</p>
                    </div>
                  </div>
                  <div className="card-modern p-6 hover:scale-[1.02] transition-all duration-300">
                    <h4 className="font-bold text-neutral-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      Payment Information
                    </h4>
                    <div className="text-body-small text-neutral-600 space-y-2">
                      <p><span className="font-semibold">Method:</span> {order.paymentMethod}</p>
                      {order.paypalTransactionId && (
                        <p><span className="font-semibold">Transaction ID:</span> {order.paypalTransactionId}</p>
                      )}
                      <p><span className="font-semibold">Status:</span> {order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}</p>
                    </div>
                  </div>
                </div>

                {/* Enhanced Admin Actions */}
                <div className="mt-8 pt-8 border-t border-neutral-200/60">
                  <h4 className="font-bold text-neutral-900 mb-6 flex items-center gap-2">
                    <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Update Order Status
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {filters?.orderStatuses.map((status: string) => (
                      <button
                        key={status}
                        onClick={() => updateOrderStatus(order._id, status)}
                        disabled={order.orderStatus === status}
                        className={`btn-modern ${
                          order.orderStatus === status
                            ? 'btn-ghost opacity-50 cursor-not-allowed'
                            : 'btn-primary'
                        } hover:scale-105 transition-all duration-300`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Orders;