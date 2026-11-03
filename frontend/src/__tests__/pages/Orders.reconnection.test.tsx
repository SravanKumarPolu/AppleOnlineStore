import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useWebSocket } from '../../hooks/useWebSocket';
import Orders from '../../pages/Orders';
import { ShopContext } from '../../context/shop-context';
import { createMockContextValue } from '../../test/helpers';

type Listener = (payload?: unknown) => void;

const socketMocks = vi.hoisted(() => {
  const created: Array<{
    connected: boolean;
    io: { opts: { reconnection: boolean } };
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    trigger: (event: string, payload?: unknown) => void;
  }> = [];
  const io = vi.fn((_url: unknown, _options: unknown) => {
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
    created.push(socket);
    return socket;
  });

  return { created, io };
});

vi.mock('socket.io-client', () => ({ io: socketMocks.io }));

const order = {
  _id: '65f1c2d3e4b5a69788776655',
  userId: 'shopper-1',
  items: [{
    productId: 'product-1',
    name: 'Test Product',
    image: '/test-product.jpg',
    price: 100,
    quantity: 1,
    color: 'Black',
  }],
  address: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    street: '1 Analytical Way',
    city: 'Springfield',
    state: 'IL',
    zipcode: '62701',
    country: 'USA',
    phone: '5550100',
  },
  paymentMethod: 'COD',
  paymentStatus: 'pending' as const,
  orderStatus: 'Shipped',
  subtotal: 100,
  shipping: 10,
  total: 110,
  currency: 'USD',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const ReconnectingOrders = () => {
  const webSocket = useWebSocket({
    token: 'shopper-token',
    userId: 'shopper-1',
  });
  const { joinOrderRoom } = webSocket;

  useEffect(() => {
    joinOrderRoom(order._id);
  }, [joinOrderRoom]);

  return (
    <ShopContext.Provider value={createMockContextValue({
      isLoggedIn: true,
      token: 'shopper-token',
      currency: '$',
      webSocket,
    })}>
      <Orders />
    </ShopContext.Provider>
  );
};

describe('Orders offline recovery', () => {
  beforeEach(() => {
    socketMocks.created.length = 0;
    socketMocks.io.mockClear();
  });

  it('reauthenticates, rejoins rooms, and fetches an admin status change after coming online', async () => {
    let serverStatus = 'Shipped';
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        orders: [{ ...order, orderStatus: serverStatus }],
        pagination: { currentPage: 1, totalPages: 1, totalOrders: 1 },
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <ReconnectingOrders />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Shipped').some((element) => element.tagName === 'SPAN')).toBe(true);
    });
    const socket = socketMocks.created[0];
    expect(socketMocks.io).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auth: { token: 'shopper-token' } }),
    );
    act(() => {
      socket.connected = true;
      socket.trigger('connect');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(new Event('offline'));
      socket.trigger('disconnect', 'transport close');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Live updates paused');

    // Simulate the admin's successful status change while the shopper has no
    // connection; no socket event is delivered during this interval.
    serverStatus = 'Out for delivery';
    act(() => window.dispatchEvent(new Event('online')));
    expect(socket.connect).toHaveBeenCalledTimes(1);

    // The new connection performs the server-authenticated handshake.
    act(() => {
      socket.connected = true;
      socket.trigger('connect');
    });

    await waitFor(() => {
      expect(
        screen.getAllByText('Out for delivery').some((element) => element.tagName === 'SPAN'),
      ).toBe(true);
    });
    expect(socket.emit).toHaveBeenCalledWith('join_order_room', order._id);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('status')).toHaveTextContent('Live updates on');
  });
});
