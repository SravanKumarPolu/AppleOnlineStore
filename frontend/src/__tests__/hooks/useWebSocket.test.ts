import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../../hooks/useWebSocket';
import type { WebSocketMessage } from '../../types';

// The socket.io-client module is mocked: the factory must not reference
// variables initialized later in module scope, so everything shared lives in
// vi.hoisted (evaluated before the mock is registered).
const mocks = vi.hoisted(() => {
  const socket = {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return { socket, io: vi.fn(() => socket) };
});

vi.mock('socket.io-client', () => ({ io: mocks.io }));

describe('useWebSocket', () => {
  beforeEach(() => {
    mocks.io.mockClear();
    mocks.socket.on.mockClear();
    mocks.socket.emit.mockClear();
    mocks.socket.connected = false;
  });

  it('does not attempt a connection without a token', () => {
    renderHook(() => useWebSocket({ token: null }));
    expect(mocks.io).not.toHaveBeenCalled();
  });

  it('connects with the auth token and registers all event handlers', () => {
    const onOrderUpdate = vi.fn();

    const { result } = renderHook(() =>
      useWebSocket({ token: 'test-token', userRole: 'user', onOrderUpdate }),
    );

    expect(mocks.io).toHaveBeenCalledTimes(1);
    expect(mocks.io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: 'test-token' } }),
    );

    for (const channel of [
      'connect',
      'disconnect',
      'connect_error',
      'order_updated',
      'new_order',
      'payment_update',
      'shipping_update',
      'user_typing',
      'user_stop_typing',
    ]) {
      expect(mocks.socket.on).toHaveBeenCalledWith(channel, expect.any(Function));
    }

    // Captured `order_updated` handler forwards payloads to the callback prop.
    const orderUpdatedCall = mocks.socket.on.mock.calls.find(
      (call) => call[0] === 'order_updated',
    );
    const handler = orderUpdatedCall?.[1] as (data: WebSocketMessage) => void;
    act(() => {
      handler({ _id: 'order-1', orderStatus: 'Shipped' });
    });
    expect(onOrderUpdate).toHaveBeenCalledWith({ _id: 'order-1', orderStatus: 'Shipped' });

    // Public API surface used by consumers.
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionError).toBeNull();
    expect(typeof result.current.connect).toBe('function');
    expect(typeof result.current.disconnect).toBe('function');
    expect(typeof result.current.joinOrderRoom).toBe('function');
    expect(result.current.socket).toBeNull();
  });

  it('exposes room-scoped emitters that respect connection state and role', () => {
    const { result } = renderHook(() =>
      useWebSocket({ token: 'test-token', userRole: 'user' }),
    );

    // Not connected: emitters are no-ops.
    act(() => {
      result.current.joinOrderRoom('order-1');
      result.current.adminJoinOrder('order-1');
    });
    expect(mocks.socket.emit).not.toHaveBeenCalled();

    // Once "connected", emitters fire the expected socket events.
    mocks.socket.connected = true;
    act(() => {
      result.current.joinOrderRoom('order-1');
      result.current.adminLeaveOrder('order-2');
      result.current.sendTyping('order-1');
      result.current.sendStopTyping('order-1');
    });
    expect(mocks.socket.emit).toHaveBeenCalledWith('join_order_room', 'order-1');
    // adminLeaveOrder only emits for admin-role users.
    expect(mocks.socket.emit).not.toHaveBeenCalledWith('admin_leave_order', 'order-2');
    expect(mocks.socket.emit).toHaveBeenCalledWith('typing', { orderId: 'order-1' });
    expect(mocks.socket.emit).toHaveBeenCalledWith('stop_typing', { orderId: 'order-1' });
  });
});
