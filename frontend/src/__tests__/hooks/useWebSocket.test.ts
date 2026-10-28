import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket, useRealtimeEvent } from '../../hooks/useWebSocket';

// ---------------------------------------------------------------------------
// Controllable socket.io-client double.
//
// The previous mock was a bag of vi.fn()s: it could not fire an event, so the
// tests could only assert that listeners were *registered*. This one keeps real
// listener bookkeeping, so the suite can prove the behaviours that regressed:
// reconnect storms, duplicate listeners, ignored auth failures and lost room
// subscriptions.
// ---------------------------------------------------------------------------
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
  listenerCount: (event: string) => number;
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
      listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    };
    return socket as unknown as FakeSocket;
  };

  const io = vi.fn(() => {
    const socket = makeSocket();
    created.push(socket);
    return socket;
  });

  return { created, io, makeSocket };
});

vi.mock('socket.io-client', () => ({ io: mocks.io }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('react-toastify', () => ({ toast }));

const orderPayload = (overrides: Record<string, unknown> = {}) => ({
  _id: 'order-1',
  eventId: `evt-${Math.random().toString(16).slice(2)}`,
  type: 'order_updated' as const,
  orderStatus: 'Packing',
  paymentStatus: 'pending',
  ...overrides,
});

/** Bring the newest socket online (as the server would). */
const goOnline = (socket: FakeSocket) => {
  socket.connected = true;
  socket.trigger('connect');
};

describe('useWebSocket', () => {
  beforeEach(() => {
    mocks.created.length = 0;
    mocks.io.mockClear();
    toast.success.mockClear();
    toast.info.mockClear();
    toast.error.mockClear();
  });

  it('does not attempt a connection without a token', () => {
    renderHook(() => useWebSocket({ token: null }));

    expect(mocks.io).not.toHaveBeenCalled();
  });

  it('connects once with the auth token and registers the real event contract', () => {
    const { result } = renderHook(() => useWebSocket({ token: 'jwt-token' }));

    expect(mocks.io).toHaveBeenCalledTimes(1);
    expect(mocks.io).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auth: { token: 'jwt-token' } }),
    );

    const socket = mocks.created[0];
    for (const channel of [
      'connect',
      'disconnect',
      'connect_error',
      'session_revoked',
      'order_updated',
      'new_order',
      'user_typing',
      'user_stop_typing',
    ]) {
      expect(socket.on).toHaveBeenCalledWith(channel, expect.any(Function));
    }

    // Payment updates arrive as `order_updated` + `type`, not a separate
    // event channel.
    expect(socket.on).not.toHaveBeenCalledWith('payment_update', expect.any(Function));

    expect(result.current.socket).toBe(socket);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.authError).toBeNull();
  });

  it('does not reconnect when callback props change identity (the reconnect storm)', () => {
    // The provider used to pass inline arrow functions, so every render gave
    // `connect` a new identity and the mount effect tore the socket down.
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useWebSocket({
          token: 'jwt-token',
          onOrderUpdate: () => tick,
          onNewOrder: () => undefined,
          onAuthError: () => undefined,
          // `tick` changes the closure identity on every render.
        }),
      { initialProps: { tick: 0 } },
    );

    for (let tick = 1; tick <= 5; tick += 1) rerender({ tick });

    expect(mocks.io).toHaveBeenCalledTimes(1);
    expect(mocks.created[0].disconnect).not.toHaveBeenCalled();
    expect(mocks.created[0].listenerCount('order_updated')).toBe(1);
  });

  it('replaces the socket exactly once when the token changes', () => {
    const { rerender } = renderHook(({ token }: { token: string }) => useWebSocket({ token }), {
      initialProps: { token: 'first-token' },
    });

    expect(mocks.io).toHaveBeenCalledTimes(1);

    rerender({ token: 'second-token' });

    expect(mocks.created[0].disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.io).toHaveBeenCalledTimes(2);
    expect(mocks.io).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ auth: { token: 'second-token' } }),
    );

    // Logging out tears the live socket down and leaves no listeners behind.
    rerender({ token: '' });
    expect(mocks.created[1].disconnect).toHaveBeenCalled();
    expect(mocks.created[1].listenerCount('order_updated')).toBe(0);
  });

  it('disconnects and unregisters listeners on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket({ token: 'jwt-token' }));
    const socket = mocks.created[0];

    unmount();

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.listenerCount('order_updated')).toBe(0);
    expect(socket.listenerCount('connect')).toBe(0);
  });

  it('never opens a second socket while one is alive', () => {
    const { result } = renderHook(() => useWebSocket({ token: 'jwt-token' }));

    act(() => {
      result.current.connect();
      result.current.connect();
    });

    expect(mocks.io).toHaveBeenCalledTimes(1);
  });

  it('stops retrying and reports an auth error when the handshake is refused', () => {
    const onAuthError = vi.fn();
    const { result } = renderHook(() => useWebSocket({ token: 'expired', onAuthError }));

    const socket = mocks.created[0];
    act(() => {
      socket.trigger('connect_error', new Error('Authentication error: Token expired'));
    });

    expect(onAuthError).toHaveBeenCalledWith('Authentication error: Token expired');
    expect(result.current.authError).toMatch(/token expired/i);
    // The retry loop is what turned a dead session into a request storm.
    expect(socket.io.opts.reconnection).toBe(false);

    // A manual reconnect is refused while the session is known to be invalid.
    act(() => {
      result.current.reconnect();
    });
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('keeps retrying a transient network failure and exposes the error', () => {
    const { result } = renderHook(() => useWebSocket({ token: 'jwt-token' }));
    const socket = mocks.created[0];

    act(() => {
      socket.trigger('connect_error', new Error('websocket error'));
    });

    expect(result.current.connectionError).toBe('websocket error');
    expect(result.current.authError).toBeNull();
    expect(socket.io.opts.reconnection).toBe(true);

    act(() => {
      result.current.reconnect();
    });
    expect(socket.connect).toHaveBeenCalled();
  });

  it('closes the feed and reports the reason when the server revokes the session', () => {
    const onAuthError = vi.fn();
    const { result } = renderHook(() => useWebSocket({ token: 'jwt-token', onAuthError }));
    const socket = mocks.created[0];
    goOnline(socket);

    act(() => {
      socket.trigger('session_revoked', { reason: 'revoked' });
    });

    expect(onAuthError).toHaveBeenCalledWith('revoked');
    expect(result.current.authError).toBe('revoked');
    expect(result.current.isConnected).toBe(false);
    expect(socket.io.opts.reconnection).toBe(false);
  });

  it('replays order-room subscriptions after a reconnect', () => {
    const { result } = renderHook(() => useWebSocket({ token: 'jwt-token' }));
    const socket = mocks.created[0];
    goOnline(socket);

    act(() => {
      result.current.joinOrderRoom('order-1');
      result.current.joinOrderRoom('order-2');
    });
    expect(socket.emit).toHaveBeenCalledWith('join_order_room', 'order-1');
    expect(socket.emit).toHaveBeenCalledWith('join_order_room', 'order-2');

    socket.emit.mockClear();
    // Automatic reconnect: the server-side room set is gone, so the client
    // must re-subscribe or the order view goes silently stale.
    act(() => {
      socket.trigger('connect');
    });
    expect(socket.emit).toHaveBeenCalledWith('join_order_room', 'order-1');
    expect(socket.emit).toHaveBeenCalledWith('join_order_room', 'order-2');

    // Leaving a room also removes it from the replay set.
    socket.emit.mockClear();
    act(() => {
      result.current.leaveOrderRoom('order-1');
    });
    act(() => {
      socket.trigger('connect');
    });
    expect(socket.emit).toHaveBeenCalledWith('join_order_room', 'order-2');
    expect(socket.emit).not.toHaveBeenCalledWith('join_order_room', 'order-1');
  });

  it('keeps room subscriptions through token refresh but clears them on account change', () => {
    const { result, rerender } = renderHook(
      ({ token, userId }: { token: string; userId: string }) =>
        useWebSocket({ token, userId }),
      { initialProps: { token: 'first-token', userId: 'user-a' } },
    );

    act(() => result.current.joinOrderRoom('order-a'));
    rerender({ token: 'refreshed-token', userId: 'user-a' });

    const refreshedSocket = mocks.created[mocks.created.length - 1];
    goOnline(refreshedSocket);
    expect(refreshedSocket.emit).toHaveBeenCalledWith('join_order_room', 'order-a');

    rerender({ token: 'other-user-token', userId: 'user-b' });
    const otherUserSocket = mocks.created[mocks.created.length - 1];
    goOnline(otherUserSocket);
    expect(otherUserSocket.emit).not.toHaveBeenCalledWith('join_order_room', 'order-a');
  });

  it('forwards an order update to the right callbacks and toasts once', () => {
    const onOrderUpdate = vi.fn();
    const onPaymentUpdate = vi.fn();
    renderHook(() => useWebSocket({ token: 'jwt-token', onOrderUpdate, onPaymentUpdate }));
    const socket = mocks.created[0];
    goOnline(socket);

    const payload = orderPayload({ type: 'payment_update', paymentStatus: 'completed' });
    act(() => {
      socket.trigger('order_updated', payload);
    });

    expect(onOrderUpdate).toHaveBeenCalledWith(payload);
    expect(onPaymentUpdate).toHaveBeenCalledWith(payload);
    expect(toast.success).toHaveBeenCalledTimes(1);

    // Same event id delivered twice (at-least-once transport) → one toast.
    act(() => {
      socket.trigger('order_updated', payload);
    });
    expect(onOrderUpdate).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('does not re-toast an event that reports the state already shown', () => {
    renderHook(() => useWebSocket({ token: 'jwt-token' }));
    const socket = mocks.created[0];
    goOnline(socket);

    act(() => {
      socket.trigger('order_updated', orderPayload({ orderStatus: 'Shipped' }));
    });
    act(() => {
      // Different event id, identical state (e.g. an unrelated field update).
      socket.trigger('order_updated', orderPayload({ orderStatus: 'Shipped' }));
    });

    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for the checkout the shopper just performed', () => {
    renderHook(() => useWebSocket({ token: 'jwt-token' }));
    const socket = mocks.created[0];
    goOnline(socket);

    act(() => {
      socket.trigger('order_updated', orderPayload({ type: 'order_created' }));
    });

    expect(toast.success).not.toHaveBeenCalled();
  });

  it('announces a new order once to an operator and never to a shopper', () => {
    const onNewOrder = vi.fn();
    const { rerender } = renderHook(
      ({ role }: { role: string }) => useWebSocket({ token: 'jwt-token', userRole: role, onNewOrder }),
      { initialProps: { role: 'admin' } },
    );
    const socket = mocks.created[0];
    goOnline(socket);

    // Same envelope delivered twice (at-least-once transport).
    const announcement = orderPayload({ type: 'order_created' });
    act(() => {
      socket.trigger('new_order', announcement);
    });
    act(() => {
      socket.trigger('new_order', announcement);
    });

    expect(onNewOrder).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith('New order received');

    rerender({ role: 'user' });
    mocks.created[0].emit.mockClear();
    act(() => {
      socket.trigger('new_order', orderPayload({ _id: 'order-2', type: 'order_created' }));
    });
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('exposes room-scoped emitters that no-op while disconnected', () => {
    const { result } = renderHook(() => useWebSocket({ token: 'jwt-token' }));
    const socket = mocks.created[0];

    act(() => {
      result.current.joinOrderRoom('order-1');
      result.current.sendTyping('order-1');
      result.current.sendStopTyping('order-1');
    });
    expect(socket.emit).not.toHaveBeenCalled();

    goOnline(socket);
    act(() => {
      result.current.sendTyping('order-1');
      result.current.sendStopTyping('order-1');
    });
    expect(socket.emit).toHaveBeenCalledWith('typing', { orderId: 'order-1' });
    expect(socket.emit).toHaveBeenCalledWith('stop_typing', { orderId: 'order-1' });
  });
});

describe('useRealtimeEvent', () => {
  it('re-registers when the socket instance changes and always calls the latest handler', () => {
    const first = mocks.makeSocket();
    const second = mocks.makeSocket();
    const early = vi.fn();
    const late = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ socket, handler }: { socket: FakeSocket | null; handler: (d: unknown) => void }) =>
        useRealtimeEvent(socket as never, 'order_updated', handler),
      { initialProps: { socket: first as FakeSocket | null, handler: early } },
    );

    act(() => {
      first.trigger('order_updated', { _id: 'a' });
    });
    expect(early).toHaveBeenCalledWith({ _id: 'a' });

    // A newer handler takes effect without re-subscribing.
    rerender({ socket: first, handler: late });
    act(() => {
      first.trigger('order_updated', { _id: 'b' });
    });
    expect(late).toHaveBeenCalledWith({ _id: 'b' });
    expect(early).toHaveBeenCalledTimes(1);

    // Replacing the socket (token change / reconnect) moves the listener.
    rerender({ socket: second, handler: late });
    expect(first.listenerCount('order_updated')).toBe(0);
    act(() => {
      second.trigger('order_updated', { _id: 'c' });
    });
    expect(late).toHaveBeenCalledWith({ _id: 'c' });

    unmount();
    expect(second.listenerCount('order_updated')).toBe(0);
  });
});
