import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShopContext } from '../context/shop-context';
import { useRealtimeEvent } from '../hooks/useWebSocket';
import { backendUrl } from '../config/backend';
import type { RealtimeOrderPayload } from '../types';
import Title from '../components/Title';
import { toast } from 'react-toastify';

interface OrderItem {
  productId: string;
  name: string;
  image: string;
  price: number;
  quantity: number;
  color: string;
}

interface Order {
  _id: string;
  userId: string;
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
  refundStatus?: string | null;
  refundReason?: string | null;
  trackingNumber?: string;
  estimatedDelivery?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

const Orders: React.FC = () => {
  // `navigate` comes from react-router directly (stable identity) instead of
  // the context wrapper, so the fetch effect below does not re-run on every
  // provider render — avoiding redundant order requests.
  const { token, isLoggedIn, currency, webSocket } = useShopContext();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  // Latest list without re-subscribing the socket on every render.
  const ordersRef = useRef<Order[]>(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const fetchOrders = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      try {
        // A background refresh must not unmount the list behind a spinner.
        if (!silent) setLoading(true);
        const response = await fetch(`${backendUrl}/api/orders/userorders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': token,
          },
          body: JSON.stringify({
            page: currentPage,
            limit: 10,
            status: selectedStatus || undefined
          }),
        });

        const data = await response.json();

        if (data.success) {
          setOrders(data.orders);
          setTotalPages(data.pagination.totalPages);
        } else if (!silent) {
          toast.error(data.message || 'Failed to fetch orders');
        }
      } catch (error) {
        console.error('Error fetching orders:', error);
        if (!silent) toast.error('Failed to fetch orders');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, currentPage, selectedStatus]
  );

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login');
      return;
    }
    fetchOrders();
  }, [isLoggedIn, navigate, fetchOrders]);

  // ---------------------------------------------------------------------
  // Live updates. The server pushes `order_updated` to every tab/device of the
  // signed-in shopper (personal room), so the list re-renders in place instead
  // of polling. A refetch only happens when an order that is NOT in the current
  // list was created and this view is the unfiltered first page — debounced, so
  // a burst of events triggers a single request.
  // ---------------------------------------------------------------------
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSilentRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      fetchOrders({ silent: true });
    }, 500);
  }, [fetchOrders]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  const applyRealtimeUpdate = useCallback(
    (payload: RealtimeOrderPayload) => {
      const id = String(payload?._id ?? '');
      if (!id) return;

      const currentOrder = ordersRef.current.find((order) => order._id === id);
      if (!currentOrder) {
        // An update to an off-page order can change filtered results,
        // pagination, or list ordering. Debouncing collapses bursts.
        scheduleSilentRefresh();
        return;
      }

      const nextOrderStatus =
        (payload.orderStatus as Order['orderStatus']) ?? currentOrder.orderStatus;
      if (selectedStatus && nextOrderStatus !== selectedStatus) {
        setOrders((previous) => previous.filter((order) => order._id !== id));
        scheduleSilentRefresh();
        return;
      }

      setOrders((previous) => {
        let changed = false;
        const next = previous.map((order) => {
          if (order._id !== id) return order;
          const merged: Order = {
            ...order,
            orderStatus: nextOrderStatus ?? order.orderStatus,
            paymentStatus:
              (payload.paymentStatus as Order['paymentStatus']) ?? order.paymentStatus,
            refundStatus: payload.refundStatus ?? order.refundStatus,
            updatedAt: payload.updatedAt ?? order.updatedAt,
          };
          // Keep the previous identity when nothing visible changed, so a
          // repeated event cannot cause a pointless re-render.
          const isSame =
            merged.orderStatus === order.orderStatus &&
            merged.paymentStatus === order.paymentStatus &&
            merged.refundStatus === order.refundStatus &&
            merged.updatedAt === order.updatedAt;
          if (isSame) return order;
          changed = true;
          return merged;
        });
        return changed ? next : previous;
      });
    },
    [selectedStatus, scheduleSilentRefresh]
  );

  useRealtimeEvent(webSocket.socket, 'order_updated', applyRealtimeUpdate);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Order Placed':
        return 'bg-blue-100 text-blue-800';
      case 'Packing':
        return 'bg-yellow-100 text-yellow-800';
      case 'Shipped':
        return 'bg-purple-100 text-purple-800';
      case 'Out for delivery':
        return 'bg-orange-100 text-orange-800';
      case 'Delivered':
        return 'bg-green-100 text-green-800';
      case 'Cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'refunded':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
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

  if (!isLoggedIn) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-14">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <Title text1="My" text2="Orders" />

        {/* Realtime status: a shopper must be able to tell a live list from a
            stale one (a paused feed is not an error, but silent staleness is). */}
        <p
          role="status"
          aria-live="polite"
          className={`mb-4 inline-flex items-center gap-2 text-sm ${webSocket.isConnected ? 'text-green-700' : 'text-gray-500'}`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${webSocket.isConnected ? 'bg-green-500' : 'bg-gray-400'}`}
          />
          {webSocket.isConnected ? 'Live updates on' : 'Live updates paused'}
          {!webSocket.isConnected && !webSocket.authError && (
            <button
              type="button"
              onClick={webSocket.reconnect}
              className="ml-2 underline underline-offset-2"
            >
              Reconnect
            </button>
          )}
        </p>
        
        {/* Filter Section */}
        <div className="mb-6 bg-white rounded-lg shadow p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <label className="text-sm font-medium text-gray-700">Filter by status:</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Orders</option>
              <option value="Order Placed">Order Placed</option>
              <option value="Packing">Packing</option>
              <option value="Shipped">Shipped</option>
              <option value="Out for delivery">Out for delivery</option>
              <option value="Delivered">Delivered</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900 mb-2">No orders found</h3>
            <p className="text-gray-500">You haven't placed any orders yet.</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Start Shopping
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {orders.map((order) => (
              <div key={order._id} className="bg-white rounded-lg shadow-md overflow-hidden">
                {/* Order Header */}
                <div className="bg-gray-50 px-6 py-4 border-b">
                  <div className="flex flex-wrap justify-between items-start gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        Order #{order._id.slice(-8).toUpperCase()}
                      </h3>
                      <p className="text-sm text-gray-600">
                        Placed on {formatDate(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.orderStatus)}`}>
                        {order.orderStatus}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getPaymentStatusColor(order.paymentStatus)}`}>
                        {order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}
                      </span>
                      {order.refundStatus === 'pending' && (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Refund processing
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Order Items */}
                <div className="p-6">
                  <div className="space-y-4">
                    {order.items.map((item, index) => (
                      <div key={index} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-16 h-16 object-cover rounded-md"
                        />
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{item.name}</h4>
                          <p className="text-sm text-gray-600">
                            Color: {item.color} | Quantity: {item.quantity}
                          </p>
                          <p className="text-sm font-medium text-gray-900">
                            {currency}{item.price.toFixed(2)} each
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-gray-900">
                            {currency}{(item.price * item.quantity).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Order Summary */}
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-600">Subtotal:</span>
                      <span className="font-medium">{currency}{order.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-gray-600">Shipping:</span>
                      <span className="font-medium">{currency}{order.shipping.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span>Total:</span>
                      <span>{currency}{order.total.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment and Shipping Info */}
                  <div className="mt-6 pt-6 border-t border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Shipping Address</h4>
                      <div className="text-sm text-gray-600">
                        <p>{order.address.firstName} {order.address.lastName}</p>
                        <p>{order.address.street}</p>
                        <p>{order.address.city}, {order.address.state} {order.address.zipcode}</p>
                        <p>{order.address.country}</p>
                        <p className="mt-1">Phone: {order.address.phone}</p>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Payment Information</h4>
                      <div className="text-sm text-gray-600">
                        <p>Method: {order.paymentMethod}</p>
                        {order.paypalTransactionId && (
                          <p>Transaction ID: {order.paypalTransactionId}</p>
                        )}
                        <p>Status: {order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-8 flex justify-center">
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-700">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Orders;
