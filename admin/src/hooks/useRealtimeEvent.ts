// Subscribe to a Socket.IO event for the lifetime of a component.
//
// The handler is held in a ref, so passing an inline arrow function (the normal
// React style) neither re-subscribes on every render nor drops events between
// renders. Re-subscribes only when the socket instance or the event changes —
// i.e. exactly once per connection.
import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

export function useRealtimeEvent<T = unknown>(
  socket: Socket | null,
  event: string,
  handler: (data: T) => void
): void {
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

export default useRealtimeEvent;
