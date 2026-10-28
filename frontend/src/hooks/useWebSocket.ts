// Realtime client for the storefront.
//
// Historical defects this rewrite removes:
//   1. `connect` was rebuilt on every render because it listed the callback
//      props in its dependency array, and the provider passed freshly-created
//      inline functions. The mount effect therefore disconnected and
//      reconnected the socket on EVERY provider render — a reconnect storm
//      that also reset room membership.
//   2. `connect()` could be called again while a socket existed, orphaning the
//      previous instance (its listeners were never removed) → duplicate toasts
//      and duplicate order updates.
//   3. Unmount/logout left the socket (and its listeners) attached to a stale
//      token.
//   4. Room subscriptions were not restored after an automatic reconnect.
//   5. An authentication failure (expired/revoked token) retried forever
//      because every `connect_error` looked transient.
//   6. `payment_update` listeners were registered for
//      events the server never emits (they arrive as `order_updated` with a
//      `type` discriminator) — dead contracts that made the real contract
//      ambiguous.
//
// The hook keeps ONE connection per authenticated context, stores callbacks in
// a ref (identity changes never reconnect), and exposes `socket` as state so
// page-level subscribers can re-register when the instance is replaced.
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'react-toastify';

import type { RealtimeOrderPayload, WebSocketMessage } from '../types';
import { socketUrl } from '../config/backend';

export type { WebSocketMessage };

/** Handshake/connection errors that a retry can never fix. */
const AUTH_ERROR_RE = /authentication error|invalid token|token expired|session revoked|not active|unauthorized/i;

/** How many event ids are remembered for duplicate suppression. */
const SEEN_EVENT_LIMIT = 200;

interface UseWebSocketProps {
  token: string | null;
  userId?: string;
  /** 'admin' suppresses shopper-facing toasts (the admin app owns its UX). */
  userRole?: string;
  onOrderUpdate?: (data: RealtimeOrderPayload) => void;
  onNewOrder?: (data: RealtimeOrderPayload) => void;
  /** Payment changes also arrive through `order_updated`. */
  onPaymentUpdate?: (data: RealtimeOrderPayload) => void;
  onTyping?: (data: WebSocketMessage) => void;
  /** Called once when the server refuses the session; the app should log out. */
  onAuthError?: (reason: string) => void;
}

const label = (value?: string | null) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : 'updated';

export const useWebSocket = ({
  token,
  userId,
  userRole,
  onOrderUpdate,
  onNewOrder,
  onPaymentUpdate,
  onTyping,
  onAuthError,
}: UseWebSocketProps) => {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Callbacks live in a ref so their identity can never trigger a reconnect.
  const handlersRef = useRef({
    onOrderUpdate,
    onNewOrder,
    onPaymentUpdate,
    onTyping,
    onAuthError,
    userRole,
  });
  handlersRef.current = {
    onOrderUpdate,
    onNewOrder,
    onPaymentUpdate,
    onTyping,
    onAuthError,
    userRole,
  };

  /** Order rooms this client wants to be in — replayed on every (re)connect. */
  const joinedRoomsRef = useRef<Set<string>>(new Set());
  /** Suppresses duplicate deliveries of the same server event id. */
  const seenEventsRef = useRef<Set<string>>(new Set());
  /** Last status signature per order: identical state must not re-toast. */
  const lastStateRef = useRef<Map<string, string>>(new Map());
  /** Orders already announced to an operator (survives reconnects). */
  const announcedOrdersRef = useRef<Set<string>>(new Set());
  const authFailedRef = useRef(false);
  const identityRef = useRef<string | null>(null);

  const rememberEvent = useCallback((eventId?: string) => {
    if (!eventId) return true;
    const seen = seenEventsRef.current;
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > SEEN_EVENT_LIMIT) {
      // Bounded memory: drop the oldest half (insertion order is preserved).
      const keep = [...seen].slice(-Math.floor(SEEN_EVENT_LIMIT / 2));
      seenEventsRef.current = new Set(keep);
    }
    return true;
  }, []);

  const teardown = useCallback((instance: Socket | null) => {
    if (!instance) return;
    // Defensive: teardown must never throw — a failure here would leave the
    // socket (and its listeners) alive past logout.
    if (typeof instance.removeAllListeners === 'function') instance.removeAllListeners();
    instance.disconnect();
  }, []);

  const disconnect = useCallback(() => {
    const instance = socketRef.current;
    socketRef.current = null;
    teardown(instance);
    setSocket(null);
    setIsConnected(false);
  }, [teardown]);

  const connect = useCallback(() => {
    if (!token) return null;
    // Single connection per authenticated context: never create a second
    // socket while one is alive.
    if (socketRef.current) return socketRef.current;

    authFailedRef.current = false;
    const instance = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      timeout: 20000,
      // Bounded retries: an unreachable backend must not retry forever. After
      // the budget the UI shows a manual "Reconnect" affordance.
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.4,
    });

    socketRef.current = instance;
    setSocket(instance);

    instance.on('connect', () => {
      setIsConnected(true);
      setConnectionError(null);
      setAuthError(null);
      authFailedRef.current = false;
      // Room membership lives on the server socket: a reconnect starts with an
      // empty room set, so every subscription is replayed here.
      for (const orderId of joinedRoomsRef.current) {
        instance.emit('join_order_room', orderId);
      }
    });

    instance.on('disconnect', (reason: string) => {
      setIsConnected(false);
      // `io server disconnect` means the server closed us deliberately (e.g.
      // revoked session); the client must not reconnect on its own.
      if (reason === 'io server disconnect') {
        setConnectionError('Disconnected by the server');
      }
    });

    instance.on('connect_error', (error: Error) => {
      const message = error?.message || 'Connection failed';
      setIsConnected(false);
      setConnectionError(message);

      if (AUTH_ERROR_RE.test(message)) {
        // Retrying an expired/revoked token can never succeed and hammers the
        // server. Stop, and let the app decide (usually: log out).
        authFailedRef.current = true;
        instance.io.opts.reconnection = false;
        setAuthError(message);
        handlersRef.current.onAuthError?.(message);
      }
    });

    // Server-initiated revocation (password reset, deactivated account,
    // rotated signing secret): the payload says why, then the transport closes.
    instance.on('session_revoked', (payload: { reason?: string } = {}) => {
      const reason = payload.reason || 'revoked';
      authFailedRef.current = true;
      instance.io.opts.reconnection = false;
      setIsConnected(false);
      setAuthError(reason);
      setConnectionError('Session ended, please sign in again');
      handlersRef.current.onAuthError?.(reason);
    });

    instance.on('order_updated', (data: RealtimeOrderPayload) => {
      if (!data || typeof data !== 'object') return;
      if (!rememberEvent(data.eventId)) return;

      const orderId = String(data._id ?? '');
      const signature = `${data.orderStatus}|${data.paymentStatus}|${data.refundStatus ?? ''}`;
      const previous = lastStateRef.current.get(orderId);
      lastStateRef.current.set(orderId, signature);

      if (data.type === 'payment_update') {
        handlersRef.current.onPaymentUpdate?.(data);
      }
      handlersRef.current.onOrderUpdate?.(data);

      // Operators get their own notifications in the admin app; a buyer who
      // just checked out already saw a confirmation, so no toast either.
      if (handlersRef.current.userRole === 'admin' || data.type === 'order_created') return;
      if (previous === signature) return;

      if (data.type === 'payment_update') {
        toast.success(`Payment status: ${label(data.paymentStatus)}`);
      } else if (data.orderStatus) {
        toast.success(`Order status: ${label(data.orderStatus)}`);
      }
    });

    instance.on('new_order', (data: RealtimeOrderPayload) => {
      if (!data || typeof data !== 'object') return;
      if (!rememberEvent(data.eventId)) return;

      handlersRef.current.onNewOrder?.(data);

      if (handlersRef.current.userRole !== 'admin') return;
      const orderId = String(data._id ?? '');
      if (announcedOrdersRef.current.has(orderId)) return;
      announcedOrdersRef.current.add(orderId);
      toast.info('New order received');
    });

    instance.on('user_typing', (data: WebSocketMessage) => {
      handlersRef.current.onTyping?.(data);
    });
    instance.on('user_stop_typing', (data: WebSocketMessage) => {
      handlersRef.current.onTyping?.(data);
    });

    return instance;
  }, [rememberEvent, token]);

  /** Manual retry, used by the "Reconnect" affordance after the budget expired. */
  const reconnect = useCallback(() => {
    if (!token || authFailedRef.current) return null;
    const instance = socketRef.current;
    if (instance) {
      if (instance.connected) return instance;
      setConnectionError(null);
      instance.connect();
      return instance;
    }
    return connect();
  }, [connect, token]);

  const joinOrderRoom = useCallback((orderId: string) => {
    if (!orderId) return;
    joinedRoomsRef.current.add(orderId);
    // Only emit while connected: socket.io-client would otherwise buffer the
    // packet AND the connect handler would replay it, sending the join twice.
    if (socketRef.current?.connected) socketRef.current.emit('join_order_room', orderId);
  }, []);

  const leaveOrderRoom = useCallback((orderId: string) => {
    if (!orderId) return;
    joinedRoomsRef.current.delete(orderId);
    if (socketRef.current?.connected) socketRef.current.emit('leave_order_room', orderId);
  }, []);

  const sendTyping = useCallback((orderId: string) => {
    if (socketRef.current?.connected) socketRef.current.emit('typing', { orderId });
  }, []);

  const sendStopTyping = useCallback((orderId: string) => {
    if (socketRef.current?.connected) socketRef.current.emit('stop_typing', { orderId });
  }, []);

  useEffect(() => {
    const identity = userId ? `user:${userId}` : `role:${userRole ?? ''}`;
    if (identityRef.current !== null && identityRef.current !== identity) {
      joinedRoomsRef.current.clear();
    }
    identityRef.current = identity;
  }, [userId, userRole]);

  // Connect on login, disconnect on logout/unmount. `connect`/`disconnect` only
  // change identity when the token does, so a re-render cannot restart the
  // connection.
  useEffect(() => {
    if (token) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [token, connect, disconnect]);

  return {
    isConnected,
    connectionError,
    authError,
    connect,
    disconnect,
    reconnect,
    joinOrderRoom,
    leaveOrderRoom,
    sendTyping,
    sendStopTyping,
    socket,
  };
};

/**
 * Subscribe to a socket event for the lifetime of a component.
 *
 * Re-registers automatically when the socket instance is replaced (token
 * change, reconnect after an instance teardown) and always calls the latest
 * handler, so callers do not need useCallback gymnastics.
 */
export function useRealtimeEvent<T = RealtimeOrderPayload>(
  socket: Socket | null,
  event: string,
  handler: (data: T) => void
) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!socket) return undefined;
    const listener = (data: T) => handlerRef.current(data);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
