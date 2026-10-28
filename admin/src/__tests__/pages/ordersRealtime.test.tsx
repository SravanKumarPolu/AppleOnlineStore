// Admin Orders page — realtime integration (real provider + real page component).
//
// Proves the acceptance flow from the operator side: a status change pushed over
// the socket flips the badge immediately, the dashboard refreshes its derived
// stats AT MOST once (debounced) and never falls back to polling.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import axios from 'axios';

type Listener = (payload?: unknown) => void;

interface FakeSocket {
  connected: boolean;
  io: { opts: { reconnection: boolean } };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  trigger: (event: string, payload?: unknown) => void;
}

const mocks = vi.hoisted(() => {
  const created: FakeSocket[] = [];
  const makeSocket = (): FakeSocket => {
    const listeners = new Map<string, Set<Listener>>();
    const socket = {
      connected: false,
      io: { opts: { reconnection: true } },
      on: vi.fn((event: string, handler: Listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
        return socket;
      }),
      off: vi.fn((event: string, handler: Listener) => {
        listeners.get(event)?.delete(handler);
        return socket;
      }),
      emit: vi.fn(() => socket),
      connect: vi.fn(() => socket),
      disconnect: vi.fn(() => {
        socket.connected = false;
        return socket;
      }),
      removeAllListeners: vi.fn(() => {
        listeners.clear();
        return socket;
      }),
      trigger: (event: string, payload?: unknown) => {
        for (const handler of [...(listeners.get(event) ?? [])]) handler(payload);
      },
    };
    return socket as unknown as FakeSocket;
  };

  const io = vi.fn(() => {
    const socket = makeSocket();
    created.push(socket);
    return socket;
  });

  return { created, io };
});

vi.mock('socket.io-client', () => ({ io: mocks.io }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('react-toastify', () => ({ toast }));

const { default: Orders } = await import('../../pages/orders');
const { default: RealtimeProvider } = await import('../../context/RealtimeProvider');

const ORDER_STATUSES = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'];

const order = {
  _id: 'a1b2c3d4e5f6a7b8c9d0e1f2',
  user: { _id: 'user-1', name: 'Ada Shopper', email: 'ada@example.com' },
  items: [
    { productId: 'p1', name: 'iPhone 15 Pro', image: 'https://example.com/a.png', price: 100, quantity: 2, color: 'Black' },
  ],
  address: {
    firstName: 'Ada',
    lastName: 'Shopper',
    email: 'ada@example.com',
    street: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    zipcode: '62701',
    country: 'USA',
    phone: '555-123-4567',
  },
  paymentMethod: 'PayPal',
  paymentStatus: 'pending',
  orderStatus: 'Order Placed',
  subtotal: 200,
  shipping: 10,
  total: 210,
  currency: 'USD',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

const ordersResponse = {
  success: true,
  orders: [order],
  pagination: { currentPage: 1, totalPages: 1, totalOrders: 1, hasNextPage: false, hasPrevPage: false, limit: 20 },
  filters: { users: [], orderStatuses: ORDER_STATUSES, paymentStatuses: ['pending', 'completed', 'failed', 'refunded'] },
  stats: {
    totalOrders: 1,
    totalRevenue: 210,
    pendingOrders: 1,
    completedOrders: 0,
    pendingPayments: 1,
    completedPayments: 0,
  },
};

const orderLabel = `Order #${order._id.slice(-8).toUpperCase()}`;

const renderLive = async () => {
  const result = render(
    <RealtimeProvider token="admin-jwt">
      <Orders token="admin-jwt" />
    </RealtimeProvider>,
  );
  await screen.findByText(orderLabel);

  const socket = mocks.created[mocks.created.length - 1]!;
  act(() => {
    socket.connected = true;
    socket.trigger('connect');
  });
  return { ...result, socket };
};

describe('Orders (admin panel) — realtime', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.created.length = 0;
    mocks.io.mockClear();
    vi.restoreAllMocks();
    getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: ordersResponse });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the connected live indicator', async () => {
    await renderLive();

    expect(screen.getByRole('status')).toHaveTextContent('Live updates on');
  });

  it('flips the status badge on a pushed update and refreshes at most once', async () => {
    const { socket } = await renderLive();
    expect(getSpy).toHaveBeenCalledTimes(1);

    act(() => {
      socket.trigger('order_updated', {
        _id: order._id,
        eventId: 'evt-1',
        type: 'order_updated',
        orderStatus: 'Shipped',
        paymentStatus: 'pending',
      });
    });

    // Badge flips immediately, without waiting for the network.
    const badge = await screen.findByText('Shipped', { selector: 'span' });
    expect(badge).toBeInTheDocument();
    // The current-status button is disabled for the new status.
    expect(screen.getByRole('button', { name: 'Shipped' })).toBeDisabled();

    // Derived stats come from the API: exactly one debounced refresh.
    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2), { timeout: 2500 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('collapses a burst of new-order events into one refresh and announces each once', async () => {
    const { socket } = await renderLive();
    expect(getSpy).toHaveBeenCalledTimes(1);

    act(() => {
      for (const id of ['b'.repeat(24), 'c'.repeat(24), 'd'.repeat(24)]) {
        socket.trigger('new_order', { _id: id, eventId: `evt-${id}`, type: 'order_created' });
      }
      // Redelivery of one of them must not add another toast.
      socket.trigger('new_order', { _id: 'b'.repeat(24), eventId: 'evt-dup', type: 'order_created' });
    });

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2), { timeout: 2500 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledTimes(3);
  });

  it('ignores an event that reports the state already on screen', async () => {
    const { socket } = await renderLive();

    act(() => {
      socket.trigger('order_updated', {
        _id: order._id,
        eventId: 'evt-2',
        type: 'order_updated',
        orderStatus: 'Order Placed',
        paymentStatus: 'pending',
        updatedAt: order.updatedAt,
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 900));
    // Nothing visible changed → no refresh at all.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
