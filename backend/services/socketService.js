// Socket.IO realtime layer.
//
// Contract (locked by __tests__/socketRealtime.spec.js and
// __tests__/socketSecurity.spec.js — update docs/05 §Socket.IO when it
// changes):
//
//   client → server   join_order_room (orderId, ack?)   ownership/role checked
//                     leave_order_room (orderId)
//                     typing / stop_typing ({ orderId })  room membership required
//   server → client   new_order        admin room, new checkout (type 'order_created')
//                     order_updated    personal room + order room + admin room,
//                                      discriminated by `type`
//                     session_revoked  { reason } then the socket is closed
//                     user_typing / user_stop_typing      chat scaffold
//
// Design rules that are easy to regress — each one encodes a real defect:
//   1. Authentication uses the SAME verifier as the HTTP middleware
//      (utils/accessToken.js): pinned algorithm, token type, account state and
//      tokenVersion. A revoked session must not keep a live feed.
//   2. Every fan-out is ONE broadcast to the union of rooms. Emitting per room
//      delivers twice to a socket that is in `user_<id>` and `order_<id>`
//      (shopper) or `admin_room` and `order_<id>` (admin).
//   3. Room keys derive from `toHexString()` / a populated `_id` — never
//      `String(object)`, which produced `user_[object Object]`.
//   4. Order rooms are private: an ObjectId is not a secret, so joining
//      requires proving ownership (or the admin role).
//   5. Emitters are null-safe: order/payment flows must never crash because
//      the realtime layer is absent (unit tests, shutdown, misconfiguration).
//   6. Payloads are built by `toRealtimeOrder`, which drops inventory internals
//      and internal bookkeeping the browser has no use for.
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

import orderModel from '../models/orderModel.js';
import { buildAllowedOrigins } from '../config/allowedOrigins.js';
import {
  verifyAccessToken,
  resolveAccessIdentity,
  extractBearerToken,
  TOKEN_FAILURE,
} from '../utils/accessToken.js';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

const ADMIN_ROOM = 'admin_room';
const DEFAULT_REVALIDATE_INTERVAL_MS = 60_000;
// Bound the per-tick DB work: revalidation walks a rotating slice instead of
// every socket on every tick, so a large fan-out cannot stampede MongoDB.
const MAX_REVALIDATIONS_PER_TICK = 200;
// A single socket cannot enumerate order rooms faster than this.
const ROOM_JOIN_LIMIT = 60;
const ROOM_JOIN_WINDOW_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export const REALTIME_EVENT_TYPES = Object.freeze({
  ORDER_CREATED: 'order_created',
  ORDER_UPDATED: 'order_updated',
  PAYMENT_UPDATE: 'payment_update',
});

export const REALTIME_EVENTS = Object.freeze({
  NEW_ORDER: 'new_order',
  ORDER_UPDATED: 'order_updated',
  SESSION_REVOKED: 'session_revoked',
  JOIN_ORDER_ROOM: 'join_order_room',
  LEAVE_ORDER_ROOM: 'leave_order_room',
  TYPING: 'typing',
  STOP_TYPING: 'stop_typing',
});

const isTestEnv = () => process.env.NODE_ENV === 'test';

/** Hex id from a raw ObjectId, a populated document, or a plain id value. */
function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    const nested = value._id ?? value.id;
    if (nested === undefined || nested === null) return null;
    return typeof nested === 'object' && typeof nested.toHexString === 'function'
      ? nested.toHexString()
      : String(nested);
  }
  return String(value);
}

function objectIdOf(value) {
  const id = idOf(value);
  return id && OBJECT_ID_RE.test(id) ? id : null;
}

/**
 * Personal-room key for a user reference.
 *
 * Callers pass either a raw ObjectId/string (order docs straight from the DB)
 * or a POPULATED user object (`userId: { _id, name, email }`). Stringifying the
 * latter yields "[object Object]", which silently addressed a room nobody had
 * joined — so a populated order update never reached the shopper.
 */
export function userRoom(userId) {
  const id = objectIdOf(userId);
  return id ? `user_${id}` : null;
}

export function orderRoom(orderId) {
  const id = objectIdOf(orderId);
  return id ? `order_${id}` : null;
}

/** Plain object from a mongoose document or an already-serialized order. */
function toPlainOrder(source) {
  if (!source || typeof source !== 'object') return null;
  // `toJSON()`-ed documents are plain objects; real documents still have toObject.
  if (typeof source.toObject === 'function') {
    return source.toObject({ virtuals: false, getters: false });
  }
  return { ...source };
}

/**
 * Minimal realtime notification. The clients fetch full orders through their
 * existing authorized HTTP endpoints; sockets carry only identifiers and
 * state needed to patch status badges. Addresses, customer details, items,
 * amounts and gateway references never fan out to every connected admin.
 */
export function toRealtimeOrder(source, { type = REALTIME_EVENT_TYPES.ORDER_UPDATED, eventId } = {}) {
  const raw = toPlainOrder(source);
  if (!raw) return null;
  const id = objectIdOf(raw._id);
  if (!id) return null;

  return {
    _id: id,
    eventId: eventId || randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    paymentStatus: raw.paymentStatus ?? null,
    orderStatus: raw.orderStatus ?? null,
    refundStatus: raw.refundStatus ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

class SocketService {
  constructor() {
    this.io = null;
    /** presence key (`user_<id>` / `admin_<email>`) -> Set<socketId> */
    this.connections = new Map();
    this.revalidationTimer = null;
    this.revalidationCursor = 0;
  }

  get isInitialized() {
    return this.io !== null;
  }

  initialize(server) {
    if (this.io) {
      // A second initialize would orphan the first server's sockets.
      return this.io;
    }

    const allowedOrigins = buildAllowedOrigins(process.env);
    this.io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      // CORS only constrains XHR/polling. A raw WebSocket upgrade bypasses the
      // browser's CORS check entirely, so the Origin header is validated for
      // both transports here against the same allow-list the HTTP layer uses.
      // Requests without an Origin (server-to-server clients, tests) are
      // allowed — identical to the Express CORS policy.
      allowRequest: (req, callback) => {
        const origin = req.headers?.origin;
        const allowed = !origin || allowedOrigins.includes(origin.replace(/\/+$/, ''));
        if (!allowed) {
          this.#log(`🚫 Socket handshake refused for origin: ${origin}`);
        }
        callback(null, allowed);
      },
    });

    this.io.use((socket, next) => {
      this.#authenticate(socket).then(
        () => next(),
        (error) => {
          // Only messages this module authored are shown to the client; an
          // unexpected internal failure must not leak its text over the wire.
          const message = error?.expose ? error.message : 'Authentication error: Invalid token';
          next(new Error(message));
        }
      );
    });

    this.setupEventHandlers();

    const intervalMs =
      Number(process.env.SOCKET_REVALIDATE_INTERVAL_MS) || DEFAULT_REVALIDATE_INTERVAL_MS;
    this.revalidationTimer = setInterval(() => {
      this.#revalidateTick().catch((error) => {
        this.#log('Socket revalidation tick failed:', error?.message || error);
      });
    }, intervalMs);
    this.revalidationTimer.unref?.();

    this.#log('🔌 WebSocket server initialized');
    return this.io;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  async #authenticate(socket) {
    const fail = (message) => {
      const error = new Error(message);
      error.expose = true;
      return error;
    };

    const auth = socket.handshake.auth || {};
    const headers = socket.handshake.headers || {};
    const token =
      extractBearerToken({
        token: auth.token,
        authorization: auth.authorization || headers.authorization,
      }) || extractBearerToken({ token: headers.token });

    if (!token) {
      // Message text is asserted by the realtime specs and shown to the client.
      throw fail('Authentication error: No token provided');
    }

    const verified = verifyAccessToken(token);
    if (!verified.ok) {
      throw fail(
        verified.reason === TOKEN_FAILURE.EXPIRED
          ? 'Authentication error: Token expired'
          : 'Authentication error: Invalid token'
      );
    }

    const resolved = await resolveAccessIdentity(verified.decoded);
    if (!resolved.ok) {
      if (
        resolved.reason === TOKEN_FAILURE.INACTIVE ||
        resolved.reason === TOKEN_FAILURE.UNKNOWN_USER
      ) {
        throw fail('Authentication error: Account is not active');
      }
      if (resolved.reason === TOKEN_FAILURE.REVOKED) {
        throw fail('Authentication error: Session revoked');
      }
      throw fail('Authentication error: Invalid token');
    }

    // The raw token is kept only to re-verify it on the revalidation tick
    // (secret rotation / expiry). It is never logged.
    socket.data.token = token;
    socket.data.identity = resolved.identity;
    socket.data.tokenId = resolved.identity.tokenId ?? null;
    socket.data.expiresAt =
      Number.isFinite(verified.decoded.exp) && verified.decoded.exp > 0
        ? verified.decoded.exp * 1000
        : null;
    socket.data.orderRooms = new Set();
  }

  #presenceKey(identity) {
    return identity?.kind === 'admin' ? `admin_${identity.email}` : `user_${identity.id}`;
  }

  #registerPresence(identity, socketId) {
    const key = this.#presenceKey(identity);
    let sockets = this.connections.get(key);
    if (!sockets) {
      sockets = new Set();
      this.connections.set(key, sockets);
    }
    sockets.add(socketId);
  }

  #unregisterPresence(identity, socketId) {
    const key = this.#presenceKey(identity);
    const sockets = this.connections.get(key);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.connections.delete(key);
  }

  #scheduleExpiry(socket) {
    const expiresAt = socket.data?.expiresAt;
    if (!expiresAt) return;

    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      this.#revoke(socket, TOKEN_FAILURE.EXPIRED);
      return;
    }

    socket.data.expiryTimer = setTimeout(() => {
      if (delay > MAX_TIMEOUT_MS) {
        this.#scheduleExpiry(socket);
        return;
      }
      this.#revoke(socket, TOKEN_FAILURE.EXPIRED);
    }, Math.min(delay, MAX_TIMEOUT_MS));
    socket.data.expiryTimer.unref?.();
  }

  /** Tell the client why its feed is going away, then close the transport. */
  #revoke(socket, reason) {
    try {
      socket.emit(REALTIME_EVENTS.SESSION_REVOKED, { reason });
    } catch {
      // A half-closed socket must not break the sweep.
    }
    socket.disconnect(true);
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const identity = socket.data.identity;
      if (!identity) {
        // Defensive: the auth middleware always sets this.
        socket.disconnect(true);
        return;
      }

      this.#registerPresence(identity, socket.id);

      if (identity.kind === 'user') {
        const room = userRoom(identity.id);
        if (room) socket.join(room);
      }
      if (identity.role === 'admin') socket.join(ADMIN_ROOM);

      this.#scheduleExpiry(socket);
      this.#log(`🔗 ${identity.kind} connected: ${identity.email}`);

      socket.on(REALTIME_EVENTS.JOIN_ORDER_ROOM, (orderId, ack) => {
        this.#handleJoinOrderRoom(socket, orderId, ack);
      });

      socket.on(REALTIME_EVENTS.LEAVE_ORDER_ROOM, (orderId) => {
        const room = orderRoom(orderId);
        if (!room) return;
        socket.leave(room);
        socket.data.orderRooms?.delete(idOf(orderId));
      });

      // Chat scaffold: relays are only honoured for a room the socket has
      // already been authorized to join, and the payload carries no PII.
      socket.on(REALTIME_EVENTS.TYPING, (data) => {
        this.#relayTyping(socket, data, 'user_typing');
      });
      socket.on(REALTIME_EVENTS.STOP_TYPING, (data) => {
        this.#relayTyping(socket, data, 'user_stop_typing');
      });

      socket.on('disconnect', (reason) => {
        if (socket.data.expiryTimer) {
          clearTimeout(socket.data.expiryTimer);
          socket.data.expiryTimer = null;
        }
        // Presence is keyed by user, not by socket: dropping one tab must not
        // unregister the shopper's other tabs.
        this.#unregisterPresence(identity, socket.id);
        socket.data.orderRooms?.clear();
        this.#log(`🔌 ${identity.kind} disconnected: ${identity.email} (${reason})`);
      });
    });
  }

  #relayTyping(socket, data, event) {
    const orderId = idOf(data?.orderId);
    if (!orderId || !OBJECT_ID_RE.test(orderId)) return;
    if (!socket.data.orderRooms?.has(orderId)) return;

    socket.to(orderRoom(orderId)).emit(event, {
      orderId,
      userId: socket.data.identity?.kind === 'user' ? socket.data.identity.id : null,
      role: socket.data.identity?.role ?? null,
    });
  }

  #consumeRoomJoinBudget(socket) {
    const now = Date.now();
    const budget = socket.data.roomJoinBudget || { windowStart: now, count: 0 };
    if (now - budget.windowStart > ROOM_JOIN_WINDOW_MS) {
      budget.windowStart = now;
      budget.count = 0;
    }
    budget.count += 1;
    socket.data.roomJoinBudget = budget;
    return budget.count <= ROOM_JOIN_LIMIT;
  }

  /**
   * Order rooms are PRIVATE: order updates carry the full order document
   * (items, shipping address, payment state). An ObjectId is not a secret, so
   * "the id is hard to guess" is not authorization. Admin joins are separately
   * gated by role.
   */
  async #handleJoinOrderRoom(socket, orderId, ack) {
    const id = idOf(orderId);
    const acknowledge = typeof ack === 'function' ? ack : () => {};

    if (!id || !OBJECT_ID_RE.test(id)) {
      acknowledge({ ok: false, error: 'invalid_order_id' });
      return;
    }
    if (!this.#consumeRoomJoinBudget(socket)) {
      acknowledge({ ok: false, error: 'rate_limited' });
      return;
    }

    const identity = socket.data.identity;
    const room = orderRoom(id);

    if (identity?.role === 'admin') {
      socket.join(room);
      socket.data.orderRooms?.add(id);
      acknowledge({ ok: true, room });
      return;
    }

    if (!identity?.id) {
      acknowledge({ ok: false, error: 'forbidden' });
      return;
    }

    try {
      const owned = await orderModel.exists({ _id: id, userId: identity.id });
      if (!owned) {
        this.#log(`🚫 Rejected order-room join: user ${identity.id} does not own order ${id}`);
        acknowledge({ ok: false, error: 'forbidden' });
        return;
      }
      socket.join(room);
      socket.data.orderRooms?.add(id);
      acknowledge({ ok: true, room });
    } catch (error) {
      this.#log('Order room authorization failed:', error?.message || error);
      acknowledge({ ok: false, error: 'error' });
    }
  }

  // ---------------------------------------------------------------------------
  // Periodic revalidation (long-lived connections)
  // ---------------------------------------------------------------------------

  async #revalidateTick() {
    const io = this.io;
    if (!io) return;

    const sockets = [...io.sockets.sockets.values()];
    if (sockets.length === 0) return;

    const start = this.revalidationCursor % sockets.length;
    const limit = Math.min(sockets.length, MAX_REVALIDATIONS_PER_TICK);
    const batch = [];
    for (let i = 0; i < limit; i += 1) {
      batch.push(sockets[(start + i) % sockets.length]);
    }
    this.revalidationCursor = (start + limit) % sockets.length;

    for (const socket of batch) {
      if (!socket.connected) continue;

      // Re-verify the raw token: this is what makes a rotated JWT_SECRET take
      // effect on already-open sockets, not just on new handshakes.
      const verified = verifyAccessToken(socket.data.token);
      if (!verified.ok) {
        this.#revoke(socket, verified.reason);
        continue;
      }

      const resolved = await resolveAccessIdentity(verified.decoded);
      if (!resolved.ok) {
        this.#revoke(socket, resolved.reason);
        continue;
      }

      // A role change moves the socket between rooms; the safe move is to make
      // the client re-handshake with a fresh token.
      if (resolved.identity.role !== socket.data.identity?.role) {
        this.#revoke(socket, 'role_changed');
        continue;
      }

      socket.data.identity = resolved.identity;
    }
  }

  /** Exposed for tests: run one bounded revalidation pass. */
  async revalidateNow() {
    await this.#revalidateTick();
  }

  // ---------------------------------------------------------------------------
  // Emit helpers — null-safe so the realtime layer can never break a money path
  // ---------------------------------------------------------------------------

  #broadcast(rooms, event, payload) {
    if (!this.io) {
      this.#log(`📦 Socket layer unavailable — skipped ${event}`);
      return false;
    }
    // ONE emit to the union: socket.io de-duplicates sockets that are in
    // several of these rooms, so a shopper in `user_<id>` + `order_<id>` (or an
    // admin in `admin_room` + `order_<id>`) receives exactly one event.
    const targets = (Array.isArray(rooms) ? rooms : [rooms]).filter(Boolean);
    if (targets.length === 0) return false;
    this.io.to(targets).emit(event, payload);
    return true;
  }

  #emitToRoom(room, event, payload) {
    return this.#broadcast([room], event, payload);
  }

  #roomSetForOrder(orderData, payload) {
    const raw = toPlainOrder(orderData);
    return [userRoom(raw?.userId), orderRoom(payload?._id), ADMIN_ROOM];
  }

  // Send order update to a specific user (all of their tabs/devices).
  //
  // Delivery goes through the user's PERSONAL ROOM (`user_<id>`), which every
  // tab/device joins on connect — rooms survive reconnects and fan out to
  // multiple sessions, which a single-socket id map could not.
  sendOrderUpdateToUser(userId, orderData, type = REALTIME_EVENT_TYPES.ORDER_UPDATED) {
    const payload = toRealtimeOrder(orderData, { type });
    if (!payload) return;
    const room = userRoom(userId ?? payload.userId);
    if (!room) return;
    this.#emitToRoom(room, REALTIME_EVENTS.ORDER_UPDATED, payload);
  }

  // Send order update to the order room (multi-party views / chat scaffold).
  sendOrderUpdateToRoom(orderId, orderData, type = REALTIME_EVENT_TYPES.ORDER_UPDATED) {
    const payload = toRealtimeOrder(orderData, { type });
    if (!payload) return;
    const room = orderRoom(orderId ?? payload._id);
    if (!room) return;
    this.#emitToRoom(room, REALTIME_EVENTS.ORDER_UPDATED, payload);
  }

  // New checkout notice for every signed-in operator.
  sendNewOrderToAdmin(orderData) {
    const payload = toRealtimeOrder(orderData, { type: REALTIME_EVENT_TYPES.ORDER_CREATED });
    if (!payload) return;
    this.#emitToRoom(ADMIN_ROOM, REALTIME_EVENTS.NEW_ORDER, payload);
  }

  // Order status change (paid, packed, shipped, cancelled…): wallet owner,
  // anyone watching the order room, and every operator — in ONE broadcast.
  sendOrderStatusUpdate(orderData) {
    const payload = toRealtimeOrder(orderData, { type: REALTIME_EVENT_TYPES.ORDER_UPDATED });
    if (!payload) return;
    this.#broadcast(this.#roomSetForOrder(orderData, payload), REALTIME_EVENTS.ORDER_UPDATED, payload);
  }

  // Payment state change (capture, refund, failure).
  sendPaymentStatusUpdate(orderData) {
    const payload = toRealtimeOrder(orderData, { type: REALTIME_EVENT_TYPES.PAYMENT_UPDATE });
    if (!payload) return;
    this.#broadcast(this.#roomSetForOrder(orderData, payload), REALTIME_EVENTS.ORDER_UPDATED, payload);
  }

  /** Revoke every live socket using one JWT session, including other tabs. */
  revokeToken(tokenId, reason = TOKEN_FAILURE.REVOKED) {
    if (!this.io || typeof tokenId !== 'string' || tokenId === '') return 0;
    let revoked = 0;
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data?.tokenId !== tokenId) continue;
      this.#revoke(socket, reason);
      revoked += 1;
    }
    return revoked;
  }

  /** Revoke all active shopper sockets after an account-wide tokenVersion bump. */
  revokeUserSessions(userId, reason = TOKEN_FAILURE.REVOKED) {
    const id = objectIdOf(userId);
    if (!this.io || !id) return 0;
    let revoked = 0;
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data?.identity?.kind !== 'user' || socket.data.identity.id !== id) continue;
      this.#revoke(socket, reason);
      revoked += 1;
    }
    return revoked;
  }

  // ---------------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------------

  /** Number of distinct connected principals (user accounts + admin sessions). */
  getConnectedUsersCount() {
    return this.connections.size;
  }

  /** Number of open sockets (a shopper with three tabs counts three times). */
  getConnectedSocketsCount() {
    let total = 0;
    for (const sockets of this.connections.values()) total += sockets.size;
    return total;
  }

  /** Connected principals with socket-level detail (never includes tokens). */
  getConnectedUsersInfo() {
    if (!this.io) return [];
    const users = [];
    for (const [presenceKey, socketIds] of this.connections.entries()) {
      for (const socketId of socketIds) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) continue;
        users.push({
          userId: socket.data?.identity?.id ?? 'admin',
          presenceKey,
          socketId,
          userEmail: socket.data?.identity?.email ?? null,
          userRole: socket.data?.identity?.role ?? null,
          connectedAt: socket.handshake?.time ?? null,
        });
      }
    }
    return users;
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  // Close the WebSocket server cleanly (graceful shutdown support).
  // Safe to call when not initialized or more than once.
  async close() {
    if (this.revalidationTimer) {
      clearInterval(this.revalidationTimer);
      this.revalidationTimer = null;
    }

    const io = this.io;
    this.io = null;

    if (!io) {
      this.connections.clear();
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        io.close(done);
      } catch {
        done();
      }
      // Guard: resolve even if the callback never fires.
      const guard = setTimeout(done, 3000);
      guard.unref?.();
    });

    this.connections.clear();
    this.revalidationCursor = 0;
    this.#log('🔌 WebSocket server closed');
  }

  #log(...args) {
    if (isTestEnv()) return;
    console.log(...args);
  }
}

// Export singleton instance
const socketService = new SocketService();
export default socketService;
