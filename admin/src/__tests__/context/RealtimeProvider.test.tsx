// Admin realtime contract.
//
// The dashboard must connect once after login, disconnect on logout, announce a
// new order exactly once, and end the session (rather than retry forever) when
// the server revokes the token. The socket is mocked with real listener
// bookkeeping so these behaviours are observable, not just "on() was called".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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

  return { created, io };
});

vi.mock('socket.io-client', () => ({ io: mocks.io }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('react-toastify', () => ({ toast }));

// Imported after the mocks so the provider picks up the double.
const { default: RealtimeProvider } = await import('../../context/RealtimeProvider');
const { useRealtime } = await import('../../context/realtime-context');
const { useRealtimeEvent } = await import('../../hooks/useRealtimeEvent');

/** Probe that renders the connection state and subscribes to an event. */
const Probe = ({ onEvent }: { onEvent?: (payload: unknown) => void }) => {
  const realtime = useRealtime();
  useRealtimeEvent(realtime.socket, 'new_order', (payload) => onEvent?.(payload));

  return (
    <div>
      <p role="status">
        {realtime.isConnected ? 'connected' : realtime.connectionError ? 'offline' : 'idle'}
      </p>
    </div>
  );
};

beforeEach(() => {
  mocks.created.length = 0;
  mocks.io.mockClear();
  toast.info.mockClear();
  toast.error.mockClear();
});

describe('admin realtime provider', () => {
  it('does not connect without a token', () => {
    render(
      <RealtimeProvider token="">
        <Probe />
      </RealtimeProvider>,
    );

    expect(mocks.io).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('idle');
  });

  it('connects with the admin token and reflects the connection state', () => {
    render(
      <RealtimeProvider token="admin-jwt">
        <Probe />
      </RealtimeProvider>,
    );

    expect(mocks.io).toHaveBeenCalledTimes(1);
    expect(mocks.io).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ auth: { token: 'admin-jwt' } }),
    );

    act(() => {
      mocks.created[0].connected = true;
      mocks.created[0].trigger('connect');
    });
    expect(screen.getByRole('status')).toHaveTextContent('connected');
  });

  it('disconnects on logout (token cleared)', () => {
    const { rerender } = render(
      <RealtimeProvider token="admin-jwt">
        <Probe />
      </RealtimeProvider>,
    );
    const socket = mocks.created[0];

    rerender(
      <RealtimeProvider token="">
        <Probe />
      </RealtimeProvider>,
    );

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.listenerCount('new_order')).toBe(0);
  });

  it('announces a new order once, even when the same event is redelivered', () => {
    const onEvent = vi.fn();
    render(
      <RealtimeProvider token="admin-jwt">
        <Probe onEvent={onEvent} />
      </RealtimeProvider>,
    );
    const socket = mocks.created[0];

    act(() => {
      socket.connected = true;
      socket.trigger('connect');
    });

    const payload = {
      _id: 'order-1',
      eventId: 'evt-1',
      type: 'order_created',
    };

    act(() => {
      socket.trigger('new_order', payload);
      socket.trigger('new_order', payload);
    });

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith('New order received');
    // The page subscriber still sees the event exactly once (same envelope).
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('ends the session instead of retrying a rejected token', () => {
    const onSessionEnded = vi.fn();
    render(
      <RealtimeProvider token="revoked-jwt" onSessionEnded={onSessionEnded}>
        <Probe />
      </RealtimeProvider>,
    );
    const socket = mocks.created[0];

    act(() => {
      socket.trigger('connect_error', new Error('Authentication error: Session revoked'));
    });

    expect(onSessionEnded).toHaveBeenCalledWith('Authentication error: Session revoked');
    expect(socket.io.opts.reconnection).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('offline');
  });

  it('reports a revoked session and disconnects', () => {
    const onSessionEnded = vi.fn();
    render(
      <RealtimeProvider token="admin-jwt" onSessionEnded={onSessionEnded}>
        <Probe />
      </RealtimeProvider>,
    );
    const socket = mocks.created[0];

    act(() => {
      socket.trigger('session_revoked', { reason: 'revoked' });
    });

    expect(onSessionEnded).toHaveBeenCalledWith('revoked');
    expect(socket.io.opts.reconnection).toBe(false);
  });

  it('keeps retrying a transient failure and exposes the error', () => {
    render(
      <RealtimeProvider token="admin-jwt">
        <Probe />
      </RealtimeProvider>,
    );
    const socket = mocks.created[0];

    act(() => {
      socket.trigger('connect_error', new Error('websocket error'));
    });

    expect(screen.getByRole('status')).toHaveTextContent('offline');
    expect(socket.io.opts.reconnection).toBe(true);
  });
});
