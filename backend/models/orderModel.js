import mongoose from "mongoose";

// Single source of truth for valid order statuses — used by the schema enum
// below and by the admin order-status update controller for server-side
// whitelist validation (Phase 1 security work area 1).
export const ORDER_STATUSES = [
  'Order Placed',
  'Packing',
  'Shipped',
  'Out for delivery',
  'Delivered',
  'Cancelled'
];

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  color: {
    type: String,
    required: true
  }
}, { _id: false });

const addressSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true },
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zipcode: { type: String, required: true },
  country: { type: String, required: true },
  phone: { type: String, required: true }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
  },
  items: [orderItemSchema],
  address: addressSchema,
  paymentMethod: {
    type: String,
    required: true,
    // 'Card' = credit/debit card recorded without a gateway integration:
    // the order is created with paymentStatus 'pending' and the store
    // arranges/collects the card payment before or on delivery (K-1 fix).
    enum: ['COD', 'PayPal', 'Card']
  },
  paymentStatus: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  orderStatus: {
    type: String,
    required: true,
    enum: ORDER_STATUSES,
    default: 'Order Placed'
  },
  subtotal: {
    type: Number,
    required: true
  },
  shipping: {
    type: Number,
    required: true,
    default: 10
  },
  total: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  // Inventory integrity: true while this order holds a stock reservation.
  // Set at order creation; cleared atomically when an admin cancels the order
  // (which restores the reserved units). Absent/undefined on legacy orders
  // created before reservation existed — those never restore stock, so
  // cancelling them can never inflate inventory.
  stockReserved: {
    type: Boolean,
    default: false
  },
  // AF-1 idempotency: client-generated per-checkout-attempt key. Absent/
  // null on legacy orders and on clients that do not send the header.
  idempotencyKey: {
    type: String,
    default: null
  },
  // PayPal specific fields
  paypalOrderId: {
    type: String,
    sparse: true // Allow null/undefined for non-PayPal orders
  },
  paypalCaptureId: {
    type: String,
    sparse: true
  },
  paypalTransactionId: {
    type: String,
    sparse: true
  },
  // Order tracking
  trackingNumber: {
    type: String,
    sparse: true
  },
  estimatedDelivery: {
    type: Date,
    sparse: true
  },
  deliveredAt: {
    type: Date,
    sparse: true
  },
  // Notes and metadata
  notes: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Indexes for better performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ orderStatus: 1 });

// AF-1 idempotency: a client-supplied key (one per checkout attempt) turns a
// duplicate COD/Card submission into a replay of the original order instead
// of a second order. Scoped per user so keys cannot collide across accounts;
// PayPal orders need no key (the gateway already dedups by paypalOrderId).
// Partial index: documents without a key (null default / legacy orders) are
// exempt from uniqueness.
orderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
// Removed duplicate indexes for paypalOrderId and paypalCaptureId since they are already sparse fields
orderSchema.index({ createdAt: -1 });

// Instance method to update order status
orderSchema.methods.updateStatus = function(newStatus) {
  this.orderStatus = newStatus;
  if (newStatus === 'Delivered') {
    this.deliveredAt = new Date();
  }
  return this.save();
};

// Instance method to update payment status
orderSchema.methods.updatePaymentStatus = function(newStatus) {
  this.paymentStatus = newStatus;
  return this.save();
};

// Static method to find orders by user
orderSchema.statics.findByUser = function(userId, options = {}) {
  const { page = 1, limit = 10, status } = options;
  const skip = (page - 1) * limit;
  
  let query = { userId, isActive: true };
  if (status) {
    query.orderStatus = status;
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to find all orders (for admin)
orderSchema.statics.findAllOrders = function(options = {}) {
  const { page = 1, limit = 20, status, paymentStatus } = options;
  const skip = (page - 1) * limit;
  
  let query = { isActive: true };
  if (status) {
    query.orderStatus = status;
  }
  if (paymentStatus) {
    query.paymentStatus = paymentStatus;
  }
  
  return this.find(query)
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to find order by PayPal order ID
orderSchema.statics.findByPayPalOrderId = function(paypalOrderId) {
  return this.findOne({ paypalOrderId, isActive: true });
};

// Static method to find order by PayPal capture ID
orderSchema.statics.findByPayPalCaptureId = function(paypalCaptureId) {
  return this.findOne({ paypalCaptureId, isActive: true });
};

// Transform output
orderSchema.methods.toJSON = function() {
  const order = this.toObject();
  delete order.__v;
  return order;
};

const orderModel = mongoose.models.order || mongoose.model("order", orderSchema);
export default orderModel; 