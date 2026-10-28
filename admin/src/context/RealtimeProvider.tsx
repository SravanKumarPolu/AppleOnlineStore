// One authenticated Socket.IO connection for the whole dashboard.
//
// Requirements this encodes:
//   - connect only after an admin login, disconnect on logout (the token prop
//     is the single source of truth);
//   - a `session_revoked` / auth handshake failure ends the session instead of
//     retrying a token the server will never accept;
//   - `new_order` is announced exactly once per order, even across reconnects
//     and duplicate deliveries;
//   - connection state is exposed so the UI can show a live/offline indicator.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'react-toastify';

import { socketUrl } from '../config';
import { RealtimeContext, type RealtimeState } from './realtime-context';

const AUTH_ERROR_RE =
  /authentication error|invalid token|token expired|session revoked|not active|unauthorized/i;

interface RealtimeProviderProps {
  token: string;
  children: ReactNode;
  /** Called when the server rejects the session (token cleared by the caller). */
  onSessionEnded?: (reason: string) => void;
}

const RealtimeProvider = ({ token, children, onSessionEnded }: RealtimeProviderProps) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const sessionEndedRef = useRef(onSessionEnded);
  sessionEndedRef.current = onSessionEnded;
  // Orders already announced: a reconnect must not re-toast the same order.
  const announcedRef = useRef<Set<string>>(new Set());

  const endSession = useCallback((reason: string) => {
    setAuthError(reason);
    setConnectionError('Session ended, please sign in again');
    setIsConnected(false);
    sessionEndedRef.current?.(reason);
  }, []);

  useEffect(() => {
    if (!token) {
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
      setConnectionError(null);
      setAuthError(null);
      return undefined;
    }

    const instance = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.4,
    });

    socketRef.current = instance;
    setSocket(instance);
    setAuthError(null);

    instance.on('connect', () => {
      setIsConnected(true);
      setConnectionError(null);
      setAuthError(null);
    });

    instance.on('disconnect', (reason: string) => {
      setIsConnected(false);
      if (reason === 'io server disconnect') setConnectionError('Disconnected by the server');
    });

    instance.on('connect_error', (error: Error) => {
      const message = error?.message || 'Connection failed';
      setIsConnected(false);
      setConnectionError(message);
      if (AUTH_ERROR_RE.test(message)) {
        // Stop the retry loop: the token will not become valid by retrying.
        instance.io.opts.reconnection = false;
        endSession(message);
      }
    });

    instance.on('session_revoked', (payload: { reason?: string } = {}) => {
      instance.io.opts.reconnection = false;
      endSession(payload.reason || 'revoked');
    });

    // Announce new checkouts once per order. The Orders page reacts to the
    // same event through useRealtimeEvent to refresh its list.
    instance.on('new_order', (data: { _id?: string }) => {
      const orderId = String(data?._id ?? '');
      if (!orderId || announcedRef.current.has(orderId)) return;
      announcedRef.current.add(orderId);
      if (announcedRef.current.size > 200) {
        announcedRef.current = new Set([...announcedRef.current].slice(-100));
      }
      toast.info('New order received');
    });

    return () => {
      instance.removeAllListeners();
      instance.disconnect();
      if (socketRef.current === instance) socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    };
  }, [token, endSession]);

  const reconnect = useCallback(() => {
    setConnectionError(null);
    const instance = socketRef.current;
    if (instance) {
      if (!instance.connected) instance.connect();
      return;
    }
    // No instance (session ended): the caller must sign in again.
  }, []);

  const value = useMemo<RealtimeState>(
    () => ({ socket, isConnected, connectionError, authError, reconnect }),
    [socket, isConnected, connectionError, authError, reconnect]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export default RealtimeProvider;
