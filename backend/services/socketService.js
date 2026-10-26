import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';
import orderModel from '../models/orderModel.js';
import { buildAllowedOrigins } from '../config/allowedOrigins.js';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Personal-room key for a user reference.
 *
 * Callers pass either a raw ObjectId/string (order docs straight from the DB)
 * or a POPULATED user object (`userId: { _id, name, email }`). Stringifying the
 * latter yields "[object Object]", which silently addressed a room nobody had
 * joined — so a populated order update never reached the shopper.
 */
function userRoom(userId) {
  if (!userId) return null;
  if (typeof userId === 'object') {
    // Raw BSON ObjectId (raw order document): `.id` is a Buffer, so stringify
    // the hex form explicitly instead of decoding the buffer as UTF-8.
    if (typeof userId.toHexString === 'function') return `user_${userId.toHexString()}`;
    const id = userId._id ?? userId.id;
    return id ? `user_${String(id)}` : null;
  }
  return `user_${String(userId)}`;
}

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // Map to store user connections
  }

  initialize(server) {
    // Phase 4 fix: origins now come from the shared factory
    // (config/allowedOrigins.js) — the same list the Express CORS policy
    // uses. Previously this list drifted (extra hardcoded localhost ports,
    // no normalization) from the HTTP policy.
    this.io = new Server(server, {
      cors: {
        origin: buildAllowedOrigins(process.env),
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.token;
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if it's an admin token
        if (decoded.type === 'admin') {
          socket.userId = null;
          socket.userRole = 'admin';
          socket.userEmail = decoded.email;
          return next();
        }

        // For regular user tokens
        const user = await userModel.findById(decoded.id);
        if (!user || !user.isActive) {
          return next(new Error('Authentication error: User not found or inactive'));
        }

        socket.userId = user._id.toString();
        socket.userRole = user.role;
        socket.userEmail = user.email;
        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Authentication error: Invalid token'));
      }
    });

    this.setupEventHandlers();
    console.log('🔌 WebSocket server initialized');
  }
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔗 User connected: ${socket.userEmail} (${socket.userRole})`);
      
      // Store user connection
      if (socket.userId) {
        this.connectedUsers.set(socket.userId, socket.id);
      } else if (socket.userRole === 'admin') {
        this.connectedUsers.set('admin', socket.id);
      }

      // Join user to their personal room
      if (socket.userId) {
        socket.join(`user_${socket.userId}`);
      }
      
      // Join admin to admin room
      if (socket.userRole === 'admin') {
        socket.join('admin_room');
      }

      // Order rooms are PRIVATE: order updates carry the full order document
      // (items, shipping address, payment state). A socket may only join an
      // order room it can prove it owns — an ObjectId is not a secret, so
      // "the id is hard to guess" is not authorization. Admin joins are
      // separately gated by role. `authorizedOrderRooms` is the allow-list the
      // typing relays consult too.
      const authorizedOrderRooms = new Set();

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.userEmail}`);
        
        // Only drop the mapping when it still points at THIS socket: a
        // shopper with two tabs open must stay "connected" when one closes.
        if (socket.userId && this.connectedUsers.get(socket.userId) === socket.id) {
          this.connectedUsers.delete(socket.userId);
        } else if (socket.userRole === 'admin' && this.connectedUsers.get('admin') === socket.id) {
          this.connectedUsers.delete('admin');
        }
        authorizedOrderRooms.clear();
      });

      // Handle join order room (for specific order updates)
      socket.on('join_order_room', async (orderId) => {
        const id = String(orderId || '');
        if (!OBJECT_ID_RE.test(id)) return;

        if (socket.userRole === 'admin') {
          socket.join(`order_${id}`);
          authorizedOrderRooms.add(id);
          console.log(`👨‍💼 Admin joined order room: ${id}`);
          return;
        }

        if (!socket.userId) return;

        try {
          const owned = await orderModel.exists({ _id: id, userId: socket.userId });
          if (!owned) {
            console.warn(
              `🚫 Rejected order-room join: user ${socket.userId} does not own order ${id}`
            );
            return;
          }
          socket.join(`order_${id}`);
          authorizedOrderRooms.add(id);
          console.log(`📦 User ${socket.userEmail} joined order room: ${id}`);
        } catch (error) {
          console.error('Order room authorization failed:', error?.message || error);
        }
      });

      // Handle leave order room
      socket.on('leave_order_room', (orderId) => {
        const id = String(orderId || '');
        socket.leave(`order_${id}`);
        authorizedOrderRooms.delete(id);
        console.log(`📦 User ${socket.userEmail} left order room: ${id}`);
      });

      // Handle admin join order room
      socket.on('admin_join_order', (orderId) => {
        if (socket.userRole === 'admin') {
          const id = String(orderId || '');
          socket.join(`order_${id}`);
          authorizedOrderRooms.add(id);
          console.log(`👨‍💼 Admin joined order room: ${id}`);
        }
      });

      // Handle admin leave order room
      socket.on('admin_leave_order', (orderId) => {
        if (socket.userRole === 'admin') {
          const id = String(orderId || '');
          socket.leave(`order_${id}`);
          authorizedOrderRooms.delete(id);
          console.log(`👨‍💼 Admin left order room: ${id}`);
        }
      });

      // Handle user typing in chat (if implemented later)
      socket.on('typing', (data) => {
        const id = String(data?.orderId || '');
        if (!authorizedOrderRooms.has(id)) return;
        socket.to(`order_${id}`).emit('user_typing', {
          userId: socket.userId,
          userEmail: socket.userEmail,
          orderId: id
        });
      });

      // Handle stop typing
      socket.on('stop_typing', (data) => {
        const id = String(data?.orderId || '');
        if (!authorizedOrderRooms.has(id)) return;
        socket.to(`order_${id}`).emit('user_stop_typing', {
          userId: socket.userId,
          userEmail: socket.userEmail,
          orderId: id
        });
      });
    });
  }

  // Internal emit helpers — null-safe so a not-yet-initialized (or already
  // closed) socket layer can never crash order/payment flows. Emits are
  // skipped with a debug log when the realtime layer is unavailable.
  #emitToRoom(room, event, data) {
    if (!this.io) {
      console.log(`📦 Socket layer unavailable — skipped ${event} to ${room}`);
      return;
    }
    this.io.to(room).emit(event, data);
  }

  #emitToSocketId(socketId, event, data) {
    if (!this.io || !socketId) return;
    this.io.to(socketId).emit(event, data);
  }

  // Send order update to specific user
  //
  // Delivery goes through the user's PERSONAL ROOM (`user_<id>`), which every
  // tab/device joins on connect. The previous implementation looked the id up
  // in `connectedUsers` with the raw value from the request (`req.user.id` is
  // an ObjectId) while the map is keyed by `String(user._id)` — the lookup
  // always missed, so shoppers silently never received `order_updated`. Rooms
  // also survive reconnects and fan out to multiple sessions, which the
  // single-socket map could not.
  sendOrderUpdateToUser(userId, orderData) {
    const room = userRoom(userId);
    if (!room) return;
    this.#emitToRoom(room, 'order_updated', orderData);
  }

  // Send order update to order room (for real-time collaboration)
  sendOrderUpdateToRoom(orderId, orderData) {
    this.#emitToRoom(`order_${orderId}`, 'order_updated', orderData);
    if (this.io) console.log(`📦 Order update sent to order room ${orderId}`);
  }

  // Send order update to admin
  sendOrderUpdateToAdmin(orderData) {
    this.#emitToRoom('admin_room', 'order_updated', orderData);
    if (this.io) console.log(`👨‍💼 Order update sent to admin`);
  }

  // Send new order notification to admin
  sendNewOrderToAdmin(orderData) {
    this.#emitToRoom('admin_room', 'new_order', orderData);
    if (this.io) console.log(`🆕 New order notification sent to admin`);
  }

  // Send order status update to all relevant parties
  sendOrderStatusUpdate(orderData) {
    const { _id: orderId, userId } = orderData;
    
    // Send to specific user
    this.sendOrderUpdateToUser(userId, orderData);
    
    // Send to order room
    this.sendOrderUpdateToRoom(orderId, orderData);
    
    // Send to admin
    this.sendOrderUpdateToAdmin(orderData);
  }

  // Send payment status update
  sendPaymentStatusUpdate(orderData) {
    const { userId } = orderData;

    // Send to specific user
    this.sendOrderUpdateToUser(userId, {
      ...orderData,
      type: 'payment_update'
    });

    // Send to admin
    this.sendOrderUpdateToAdmin({
      ...orderData,
      type: 'payment_update'
    });
  }

  // Send shipping update
  sendShippingUpdate(orderData) {
    const { userId } = orderData;
    
    // Send to specific user
    this.sendOrderUpdateToUser(userId, {
      ...orderData,
      type: 'shipping_update'
    });
    
    // Send to admin
    this.sendOrderUpdateToAdmin({
      ...orderData,
      type: 'shipping_update'
    });
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  // Get connected users info (for admin)
  getConnectedUsersInfo() {
    if (!this.io) return [];
    const users = [];
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        users.push({
          userId,
          socketId,
          userEmail: socket.userEmail,
          userRole: socket.userRole,
          connectedAt: socket.handshake.time
        });
      }
    }
    return users;
  }

  // Close the WebSocket server cleanly (graceful shutdown support).
  // Safe to call when not initialized or more than once.
  async close() {
    if (this.io) {
      await new Promise((resolve) => {
        this.io.close(() => resolve());
        // Guard: resolve even if the callback never fires
        setTimeout(resolve, 3000).unref?.();
      });
      this.io = null;
      this.connectedUsers.clear();
      console.log('🔌 WebSocket server closed');
    }
  }
}

// Export singleton instance
const socketService = new SocketService();
export default socketService; 