// Realtime context for the operator dashboard.
//
// Kept in its own module (no components) so React Fast Refresh stays happy and
// so `useRealtime()` can return a safe default when no provider is mounted —
// the page tests render `Orders` standalone and must not crash.
import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

export interface RealtimeState {
  /** True while the socket transport is up. */
  isConnected: boolean;
  /** Last transport error (null once connected). */
  connectionError: string | null;
  /** Set when the server refused/revoked the session. */
  authError: string | null;
  socket: Socket | null;
  /** Manual retry after the automatic budget is exhausted. */
  reconnect: () => void;
}

export const defaultRealtimeState: RealtimeState = {
  isConnected: false,
  connectionError: null,
  authError: null,
  socket: null,
  reconnect: () => undefined,
};

export const RealtimeContext = createContext<RealtimeState>(defaultRealtimeState);

export const useRealtime = (): RealtimeState => useContext(RealtimeContext);

export default RealtimeContext;
