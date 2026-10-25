import paypal from '@paypal/checkout-server-sdk';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import orderModel, { ORDER_STATUSES } from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import productModel from '../models/productModel.js';
import socketService from '../services/socketService.js';
import webhookEventModel from '../models/webhookEventModel.js';
import { redactError } from '../utils/redact.js';
import { getActiveWebhookVerifier } from '../services/paypalWebhookService.js';
import { createPayPalEnvironment } from '../config/paypalEnv.js';
import { UserActivity, ProductPerformance } from '../models/analyticsModel.js';

dotenv.config();

// PayPal configuration - ONLY USD SUPPORT.
// Environment selection is centralized in config/paypalEnv.js (PAYPAL_ENV=live
// opts in to live; anything else targets sandbox) so the capture flow and the
// webhook verifier can never disagree about which PayPal they are talking to.
const client = new paypal.core.PayPalHttpClient(
  createPayPalEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// Test seam — lets the security suite substitute the PayPal HTTP client (the
// network edge) so capture-flow decision logic (amount/currency verification,
// webhook reconciliation sweep) can run offline, mirroring the
// setActiveWebhookVerifier seam used for webhook signature verification.
let paypalClientOverride = null;

function getPayPalClient() {
  return paypalClientOverride || client;
}

export function setPayPalClientForTests(override) {
  paypalClientOverride = override;
}

// Payment methods accepted by the generic order-creation endpoint. Kept in
// lockstep with the order schema enum (orderModel.js paymentMethod).
// 'PayPal' is intentionally NOT accepted here: PayPal orders must be created
// through /api/orders/paypal/create so they carry a paypalOrderId the webhook
// matcher can reconcile. A 'PayPal'-labeled order without a paypalOrderId
// would be an orphan the webhook pipeline can never complete.
const PAYMENT_METHODS = ['COD', 'Card'];

// ---------- Server-side pricing & inventory integrity (P-1/P-2/I-1/I-2) ----------
// The client-supplied items[] array is UNTRUSTED. Prices are ALWAYS taken
// from the products collection, quantities are bounded, and stock is
// reserved atomically so concurrent orders can never oversell.

const MAX_ITEM_QUANTITY = 999;

function isValidObjectId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && mongoose.isValidObjectId(id);
}

// Validates the items[] shape (never trusts client prices for real products).
function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, message: 'Items must be a non-empty array' };
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { valid: false, message: 'Each item must be an object' };
    }
    if (typeof item.productId !== 'string' || item.productId.length === 0) {
      return { valid: false, message: 'Each item requires a productId' };
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      return { valid: false, message: `Quantity must be an integer between 1 and ${MAX_ITEM_QUANTITY}` };
    }
    // The client price is discarded by priceOrderItems, but an obviously
    // invalid value (negative / zero / NaN / null / string) signals tampering
    // or a broken client — reject the request instead of silently repricing.
    // Only a genuinely absent price (undefined) is tolerated.
    if (item.price !== undefined) {
      if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0) {
        return { valid: false, message: 'Item price must be a positive number' };
      }
    }
  }
  return { valid: true };
}

// Resolves every item against the products collection. Returns the priced
// items (DB price, DB name/image) or a 4xx-style failure.
async function priceOrderItems(items) {
  const ids = [...new Set(items.map((i) => i.productId))].filter(isValidObjectId);
  const products = await productModel.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const priced = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      return {
        ok: false,
        status: 400,
        message: `Product not found: ${String(item.productId).slice(0, 40)}`,
      };
    }
    priced.push({
      productId: String(product._id),
      name: product.name,
      image: Array.isArray(product.image) ? product.image[0] : product.image,
      price: product.price, // SERVER-SIDE PRICE — client price is discarded
      quantity: item.quantity,
      color: item.color,
    });
  }
  return { ok: true, items: priced };
}

// Atomically reserves stock for each item. Returns the list of reservations
// made so a failure can roll them back. The findOneAndUpdate filter makes
// each decrement race-free: if two buyers race for the last unit, exactly one
// update matches `stockQuantity >= qty`.
async function reserveStock(pricedItems) {
  const reserved = [];
  for (const item of pricedItems) {
    const updated = await productModel.findOneAndUpdate(
      { _id: item.productId, inStock: true, stockQuantity: { $gte: item.quantity } },
      { $inc: { stockQuantity: -item.quantity } },
      { new: true }
    );
    if (!updated) {
      return { ok: false, reserved, message: `Insufficient stock for "${item.name}"` };
    }
    reserved.push({ productId: item.productId, quantity: item.quantity });
  }
  return { ok: true, reserved };
}

// Rolls back reservations (best-effort) after a mid-flow failure.
async function releaseStock(reserved) {
  for (const r of reserved) {
    try {
      await productModel.updateOne(
        { _id: r.productId },
        { $inc: { stockQuantity: r.quantity }, $set: { inStock: true } }
      );
    } catch (e) {
      console.error('Stock release failure:', redactError(e));
    }
  }
}

const placeOrder = async (req, res) => {
  try {
    const { items, address, paymentMethod } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    // AF-1 idempotency: an optional client-generated per-checkout-attempt
    // key. Present key + already-placed order with that key => replay the
    // original order instead of creating (and reserving stock for) a second
    // one. Absent/empty key keeps the legacy behavior (no dedup) so old
    // clients and the documented AF-1 spec stay compatible.
    const rawIdempotencyKey = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';
    if (idempotencyKey.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Idempotency-Key header too long (max 200 characters)'
      });
    }
    if (idempotencyKey) {
      const existing = await orderModel
        .findOne({ userId, idempotencyKey })
        .lean();
      if (existing) {
        return res.json({
          success: true,
          message: 'Order already placed',
          order: existing,
          idempotentReplay: true
        });
      }
    }
    
    // Validate required fields
    if (!items || !address || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Items, address, and payment method are required'
      });
    }

    // Whitelist the payment method before touching the database (K-1 fix):
    // 'COD' and 'Card' create real (unpaid) orders via this endpoint, while
    // PayPal orders are created by /paypal/create + /paypal/capture. Unknown
    // or miscased values (e.g. 'cod', 'stripe') get an explicit 400 instead
    // of a mongoose ValidationError surfacing as a generic 500.
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Must be one of: ${PAYMENT_METHODS.join(', ')}`
      });
    }

    // P-2: reject non-array / empty items arrays before any DB work.
    const shape = validateOrderItems(items);
    if (!shape.valid) {
      return res.status(400).json({ success: false, message: shape.message });
    }

    // P-1: price the order from the products collection — client-supplied
    // prices are discarded. Unknown products are rejected (no phantom orders).
    const pricing = await priceOrderItems(items);
    if (!pricing.ok) {
      return res.status(pricing.status || 400).json({
        success: false,
        message: pricing.message
      });
    }
    const pricedItems = pricing.items;

    // Calculate total amount from SERVER-SIDE prices only.
    const subtotal = pricedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = 10; // Fixed shipping cost
    const total = subtotal + shipping;

    // I-1/I-2: atomically reserve stock; never allow oversell.
    const reservation = await reserveStock(pricedItems);
    if (!reservation.ok) {
      await releaseStock(reservation.reserved); // roll back partial reservations
      return res.status(400).json({
        success: false,
        message: reservation.message
      });
    }

    // Create order object
    const orderData = {
      userId,
      items: pricedItems,
      address,
      paymentMethod,
      subtotal,
      shipping,
      total,
      currency: 'USD',
      paymentStatus: 'pending',
      orderStatus: 'Order Placed',
      stockReserved: true // reservation happened above; cancel restores it
    };
    if (idempotencyKey) {
      orderData.idempotencyKey = idempotencyKey;
    }

    // Save order to database
    const order = new orderModel(orderData);
    try {
      await order.save();
    } catch (saveError) {
      // AF-1 race window: two concurrent requests with the same key can both
      // pass the pre-check above; the unique partial index decides the winner
      // at save time. The loser releases its reservation and replays the
      // winner's order instead of surfacing a 500.
      const isDuplicateKey =
        saveError &&
        (saveError.code === 11000 ||
          /E11000 duplicate key/i.test(String(saveError.message))) &&
        idempotencyKey;
      if (isDuplicateKey) {
        await releaseStock(reservation.reserved);
        const winner = await orderModel
          .findOne({ userId, idempotencyKey })
          .lean();
        if (winner) {
          return res.json({
            success: true,
            message: 'Order already placed',
            order: winner,
            idempotentReplay: true
          });
        }
      }
      await releaseStock(reservation.reserved); // I-4: DB failure must not eat stock
      throw saveError;
    }

    // Track user activity
    try {
      await UserActivity.trackActivity({
        userId,
        action: 'purchase',
        sessionId: req.session?.id
      });

      // Track product metrics for each item
      for (const item of pricedItems) {
        await ProductPerformance.updateProductMetrics(item.productId, {
          purchaseCount: item.quantity,
          revenue: item.price * item.quantity
        });
      }
    } catch (analyticsError) {
      console.error('Analytics tracking error:', analyticsError);
      // Don't fail the order if analytics tracking fails
    }

    // Add order to user's orders array
    await userModel.findByIdAndUpdate(userId, { 
      $push: { orders: order._id },
      cartData: {} 
    });

    // Send real-time notifications
    const orderWithUser = await orderModel.findById(order._id).populate('userId', 'name email');
    
    // Send new order notification to admin
    socketService.sendNewOrderToAdmin(orderWithUser.toJSON());
    
    // Send order update to user
    socketService.sendOrderUpdateToUser(userId, orderWithUser.toJSON());
    
    res.json({
      success: true,
      message: 'Order placed successfully',
      order: order.toJSON()
    });

  } catch (error) {
    console.error('Place order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const placeOrderPayPal = async (req, res) => {
  try {
    const { items, address } = req.body;
    const userId = req.user?.id;
    
    // STRICT USD ONLY - No currency detection, no fallbacks
    console.log('🚀 Creating PayPal order with USD ONLY');
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }
    
    if (!items || !address) {
      return res.status(400).json({
        success: false,
        message: 'Items and address are required'
      });
    }

    // P-2: reject non-array / empty items arrays before any DB or PayPal work.
    const shape = validateOrderItems(items);
    if (!shape.valid) {
      return res.status(400).json({ success: false, message: shape.message });
    }

    // P-1: price the order from the products collection — the client-supplied
    // price is discarded so it can never reach the PayPal amount.
    const pricing = await priceOrderItems(items);
    if (!pricing.ok) {
      return res.status(pricing.status || 400).json({
        success: false,
        message: pricing.message
      });
    }
    const pricedItems = pricing.items;

    // Calculate amounts from SERVER-SIDE prices only.
    const subtotal = pricedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = 10;
    const total = subtotal + shipping;

    // Validate amounts
    if (total <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order total'
      });
    }

    // Ensure minimum order amount for PayPal
    if (total < 0.01) {
      return res.status(400).json({
        success: false,
        message: 'Order total must be at least $0.01'
      });
    }

    // Create PayPal order with STRICT USD configuration
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    
    // Force US address for maximum PayPal compatibility
    const paypalShippingAddress = {
      address_line_1: address.street || '123 Test St',
      admin_area_2: address.city || 'Test City',
      admin_area_1: address.state || 'CA',
      postal_code: address.zipcode || '12345',
      country_code: 'US' // ALWAYS US for PayPal sandbox
    };
    
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD', // STRICT USD ONLY
          value: total.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: subtotal.toFixed(2)
            },
            shipping: {
              currency_code: 'USD',
              value: shipping.toFixed(2)
            }
          }
        },
        items: pricedItems.map(item => ({
          name: item.name,
          unit_amount: {
            currency_code: 'USD', // STRICT USD ONLY
            value: item.price.toFixed(2)
          },
          quantity: item.quantity.toString(),
          category: 'PHYSICAL_GOODS'
        })),
        shipping: {
          address: paypalShippingAddress
        },
        payee: {
          email_address: 'sb-business@business.example.com' // PayPal sandbox business account
        }
      }],
      application_context: {
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/cancel`,
        user_action: 'PAY_NOW',
        payment_method: {
          payer_selected: 'PAYPAL',
          payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED'
        },
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        locale: 'en-US', // Force US locale
        landing_page: 'LOGIN', // Force login page
        brand_name: 'E-commerce Store'
      }
    });

    // Debug logging
    console.log('💰 PayPal Order Details:');
    console.log('  - Currency: USD (STRICT)');
    console.log('  - Total Amount:', total.toFixed(2));
    console.log('  - Shipping Address: US (forced)');
    console.log('  - Items Count:', items.length);

    // Execute PayPal order creation
    const order = await getPayPalClient().execute(request);
    console.log('✅ PayPal order created successfully with USD');
    console.log('  - Order ID:', order.result.id);
    console.log('  - Status:', order.result.status);
    
    // I-1/I-2: reserve stock at PayPal-order creation (the reservation is
    // the shopper's hold on the inventory; the capture/webhook pipeline never
    // touches stock, so a single payment can never deduct twice).
    const reservation = await reserveStock(pricedItems);
    if (!reservation.ok) {
      await releaseStock(reservation.reserved);
      return res.status(400).json({
        success: false,
        message: reservation.message
      });
    }

    // Save order to database with PayPal order ID
    const orderData = {
      userId,
      items: pricedItems,
      address,
      paymentMethod: 'PayPal',
      subtotal,
      shipping,
      total,
      currency: 'USD', // STRICT USD
      paypalOrderId: order.result.id,
      paymentStatus: 'pending',
      orderStatus: 'Order Placed',
      stockReserved: true
    };

    const dbOrder = new orderModel(orderData);
    try {
      await dbOrder.save();
    } catch (saveError) {
      await releaseStock(reservation.reserved); // DB failure must not eat stock
      throw saveError;
    }
    
    console.log('📦 Order saved to database:', dbOrder._id);
    
    // Add order to user's orders array
    try {
      await userModel.findByIdAndUpdate(
        userId,
        { $push: { orders: dbOrder._id } }
      );
      console.log('👤 Order added to user:', userId);
    } catch (userUpdateError) {
      console.error('❌ Error adding order to user:', redactError(userUpdateError));
      // Don't fail the order creation if user update fails
    }
    
    res.json({
      success: true,
      orderId: order.result.id,
      links: order.result.links,
      dbOrderId: dbOrder._id,
      currency: 'USD' // Confirm USD usage
    });

  } catch (error) {
    // Task 5: always a redacted one-liner; verbose PayPal internals stay out
    // of production logs (payer data, provider payloads).
    console.error('❌ PayPal order creation failed:', redactError(error));

    if (error.response) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('  - PayPal API Status:', error.response.status);
        console.error('  - PayPal API Data:', JSON.stringify(error.response.data));
      }

      // Check for specific PayPal error codes
      if (error.response.data && error.response.data.details) {
        const currencyError = error.response.data.details.find(detail => 
          detail.issue && detail.issue.includes('CURRENCY')
        );
        
        if (currencyError) {
          console.error('🚨 CURRENCY ERROR DETECTED:', currencyError.issue || 'currency issue');
          return res.status(400).json({
            success: false,
            message: 'PayPal currency issue detected. Please use Credit/Debit Card or Cash on Delivery instead.',
            error: 'CURRENCY_NOT_SUPPORTED',
            alternative: 'Use Credit/Debit Card or Cash on Delivery'
          });
        }
      }
    }
    
    // Provide user-friendly error message
    let errorMessage = 'PayPal payment is not available. Please try Credit/Debit Card or Cash on Delivery.';
    
    if (error.message && error.message.includes('currency')) {
      errorMessage = 'PayPal currency issue detected. Please use Credit/Debit Card or Cash on Delivery.';
    } else if (error.message && error.message.includes('seller')) {
      errorMessage = 'PayPal payment not available for your region. Please use Credit/Debit Card or Cash on Delivery.';
    } else if (error.message && error.message.includes('country')) {
      errorMessage = 'PayPal payment not available for your country. Please use Credit/Debit Card or Cash on Delivery.';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: 'PAYPAL_UNAVAILABLE',
      alternative: 'Use Credit/Debit Card or Cash on Delivery'
    });
  }
};

const capturePayPalPayment = async (req, res) => {
  try {
    const { orderID } = req.body;
    const userId = req.user?.id;
    
    console.log('🔄 Capturing PayPal payment:', { orderID, userId });
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }
    
    if (!orderID) {
      return res.status(400).json({
        success: false,
        message: 'PayPal order ID is required'
      });
    }

    // First, verify the order exists and is in correct state
    const existingOrder = await orderModel.findOne({ paypalOrderId: orderID, userId });
    if (!existingOrder) {
      console.error('❌ Order not found for PayPal order ID:', orderID);
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (existingOrder.paymentStatus === 'completed') {
      console.log('⚠️ Payment already completed for order:', orderID);
      return res.json({
        success: true,
        message: 'Payment already completed',
        order: existingOrder.toJSON()
      });
    }

    // Capture the PayPal payment
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});
    
    console.log('💰 Executing PayPal capture request...');
    const capture = await getPayPalClient().execute(request);
    // Log status only — the full response contains payer PII.
    console.log('✅ PayPal capture response status:', capture.result.status);
    
    if (capture.result.status === 'COMPLETED') {
      console.log('🎉 Payment completed successfully');
      
      // Extract capture details
      const captureId = capture.result.purchase_units[0].payments.captures[0].id;
      const transactionId = capture.result.purchase_units[0].payments.captures[0].id;
      const captureAmount = capture.result.purchase_units[0].payments.captures[0].amount.value;
      const captureCurrency =
        capture.result.purchase_units[0].payments.captures[0].amount.currency_code;
      
      console.log('💰 Capture details:', {
        captureId,
        transactionId,
        amount: captureAmount,
        currency: captureCurrency
      });

      // Final gate Task 6 — verify the captured amount/currency equals the
      // expected payment BEFORE updating the order (the same guarantee the
      // webhook path enforces). A mismatch (partial capture, currency swap,
      // tampered order total) must never mark an order as paid.
      const capturedCents = parseAmountToCents(captureAmount);
      const expectedCents = Math.round(existingOrder.total * 100);
      if (
        !Number.isFinite(capturedCents) ||
        capturedCents !== expectedCents ||
        String(captureCurrency || '').toUpperCase() !== existingOrder.currency.toUpperCase()
      ) {
        alertUnresolvedWebhook('capture_amount_mismatch', {
          paypalOrderId: orderID,
          captureId,
          capturedAmount: captureAmount,
          capturedCurrency: captureCurrency,
          expectedTotal: existingOrder.total,
          expectedCurrency: existingOrder.currency,
        });
        return res.status(409).json({
          success: false,
          message: 'Captured amount or currency does not match the order total; order not marked as paid'
        });
      }
      
      // Update order in database
      const order = await orderModel.findOneAndUpdate(
        { paypalOrderId: orderID, userId },
        {
          paymentStatus: 'completed',
          paypalCaptureId: captureId,
          paypalTransactionId: transactionId,
          orderStatus: 'Order Placed'
        },
        { new: true }
      );
      
      console.log('📦 Order updated in database:', order._id);

      // Final gate Task 6 — close out webhook events that arrived DURING this
      // request (the classic race: PayPal delivers PAYMENT.CAPTURE.COMPLETED
      // before this DB write lands, the webhook found no capture id and was
      // left 'unresolved' awaiting retry). This trusted API response has now
      // realized the event's effect, so those records are reconciled here.
      // Mismatch-flagged events are deliberately NOT auto-closed.
      try {
        await webhookEventModel.updateMany(
          {
            resourceId: captureId,
            status: {
              $in: [WEBHOOK_EVENT_STATUSES.UNRESOLVED, WEBHOOK_EVENT_STATUSES.FAILED],
            },
            result: { $in: [WEBHOOK_RESULTS.NO_MATCHING_ORDER, null] },
          },
          {
            $set: {
              status: WEBHOOK_EVENT_STATUSES.COMPLETED,
              result: WEBHOOK_RESULTS.ORDER_UPDATED,
              completedAt: new Date(),
              lastError: null,
            },
          }
        );
      } catch (sweepError) {
        console.error('Webhook event reconciliation sweep failed:', redactError(sweepError));
        // Non-fatal: PayPal retries + the unresolved record still cover these
        // events if the sweep ever fails.
      }

      // Clear user's cart after successful payment
      await userModel.findByIdAndUpdate(userId, { cartData: {} });
      console.log('🛒 Cart cleared for user:', userId);
      
      // Send real-time notifications
      const orderWithUser = await orderModel.findById(order._id).populate('userId', 'name email');
      
      // Send payment status update to user
      socketService.sendPaymentStatusUpdate(orderWithUser.toJSON());
      
      // Send order status update to admin
      socketService.sendOrderUpdateToAdmin(orderWithUser.toJSON());
      
      res.json({
        success: true,
        message: 'Payment captured successfully',
        order: order.toJSON(),
        captureDetails: {
          captureId,
          transactionId,
          amount: captureAmount
        }
      });
    } else {
      console.error('❌ Payment capture failed with status:', capture.result.status);
      if (process.env.NODE_ENV !== 'production') {
        console.error('❌ Full capture response:', JSON.stringify(capture.result, null, 2));
      }

      // Task 5: raw PayPal capture payloads are never returned to clients in
      // production (they carry payer/payment internals).
      const captureFailureBody = {
        success: false,
        message: `Payment capture failed with status: ${capture.result.status}`,
      };
      if (process.env.NODE_ENV !== 'production') {
        captureFailureBody.details = capture.result;
      }
      res.status(400).json(captureFailureBody);
    }
    
  } catch (error) {
    console.error('❌ PayPal capture error:', redactError(error));
    if (process.env.NODE_ENV !== 'production' && error.response?.data) {
      console.error('❌ Error details:', JSON.stringify(error.response.data));
    }

    // Task 5: stable error code in production — raw driver/provider messages
    // can embed connection strings and payer data.
    res.status(500).json({
      success: false,
      message: 'Failed to capture payment',
      error: process.env.NODE_ENV === 'production' ? 'PAYPAL_CAPTURE_ERROR' : redactError(error)
    });
  }
};

// ---------------------------------------------------------------------------
// PayPal webhook processing — recoverable idempotency (final gate Task 1) +
// safe handling of unmatched captures (final gate Task 6).
//
// A retry delivery is acknowledged as a duplicate ONLY when the event record
// reached status 'completed'. A previous attempt that failed, was
// interrupted (stale 'processing'), could not yet be matched to an order
// ('unresolved'), or a legacy record with no status field is re-acquired and
// re-processed — the order update itself is idempotent, so re-processing is
// always safe. This closes the window where an interrupted order update
// would otherwise be acknowledged as done.
//
// Unmatched PAYMENT.CAPTURE.COMPLETED events are NEVER acknowledged as
// complete: the order row may appear moments later (delayed order creation,
// or the webhook racing the capture endpoint's DB write). Instead the event
// is marked 'unresolved' and retried within a bounded budget; once the
// budget is exhausted it is acknowledged with a terminal
// 'no_matching_order_retry_exhausted' result and an alert is raised for
// manual reconciliation.
// ---------------------------------------------------------------------------
const WEBHOOK_EVENT_STATUSES = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNRESOLVED: 'unresolved',
};

const WEBHOOK_RESULTS = {
  ORDER_UPDATED: 'order_updated',
  ORDER_UPDATED_RECONCILED: 'order_updated_reconciled',
  NO_MATCHING_ORDER: 'no_matching_order',
  NO_MATCHING_ORDER_RETRY_EXHAUSTED: 'no_matching_order_retry_exhausted',
  AMOUNT_CURRENCY_MISMATCH: 'amount_currency_mismatch',
  CAPTURE_ORDER_MISMATCH: 'capture_order_mismatch',
  IGNORED_EVENT_TYPE: 'ignored_event_type',
};

function getWebhookProcessingLockMs() {
  const parsed = Number(process.env.WEBHOOK_PROCESSING_LOCK_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
}

// Bounded retry budget for verified captures that cannot be matched to an
// order yet (PayPal itself retries deliveries for up to 3 days, so the
// budget must stay below that horizon).
function getWebhookMaxUnmatchedAttempts() {
  const parsed = Number(process.env.WEBHOOK_MAX_UNMATCHED_ATTEMPTS);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 10;
}

// Parse a PayPal decimal string ("20.00") into integer cents. Returns NaN for
// anything non-numeric — callers treat NaN as a verification failure.
function parseAmountToCents(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return NaN;
  }
  const [whole, fraction = ''] = value.trim().split('.');
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

// Ops-facing alert for webhook outcomes that require human attention.
// Structured + grep-friendly so log pipelines / alerting rules can route it.
function alertUnresolvedWebhook(reason, details) {
  console.error(`🚨 PAYMENT WEBHOOK ALERT [${reason}] ${JSON.stringify(details)}`);
}

async function markWebhookEventFailed(recordId, error) {
  try {
    await webhookEventModel.updateOne(
      { _id: recordId },
      {
        $set: {
          status: WEBHOOK_EVENT_STATUSES.FAILED,
          lastError: redactError(error).slice(0, 500),
        },
      }
    );
  } catch (markError) {
    // Failure bookkeeping must never mask the original processing failure —
    // the 500 response still tells PayPal to retry.
    console.error('Failed to mark webhook event as failed:', redactError(markError));
  }
}

async function markWebhookEventUnresolved(recordId, { result, note }) {
  try {
    await webhookEventModel.updateOne(
      { _id: recordId },
      {
        $set: {
          status: WEBHOOK_EVENT_STATUSES.UNRESOLVED,
          result,
          lastError: String(note).slice(0, 500),
        },
      }
    );
  } catch (markError) {
    // Bookkeeping must never mask the processing outcome — the HTTP response
    // still drives PayPal's retry behavior.
    console.error('Failed to mark webhook event as unresolved:', redactError(markError));
  }
}

// Final gate Task 6 — apply a signature-verified PAYMENT.CAPTURE.COMPLETED
// event to exactly the order it belongs to, or defer it for retry.
//
// Identity: an order is only updated when the capture id matches the order's
// recorded `paypalCaptureId`, OR — for the delayed-creation / capture-race
// case — when the PayPal order id carried by the signed event
// (resource.supplementary_data.related_ids.order_id) matches the order's
// `paypalOrderId`. Amount AND currency must equal the expected payment
// (order.total / order.currency) before any write. Refunded orders are never
// clobbered back to 'completed'.
//
// Returns one of:
//   { unresolved: false, result }                     — event fully processed
//   { unresolved: true, httpStatus, success, message, result, note, alert }
async function processCaptureCompletedEvent(event, record) {
  const captureId = event.resource.id;
  const eventAmount = event.resource.amount.value;
  const eventCurrency = event.resource.amount.currency_code.toUpperCase();
  const eventCents = parseAmountToCents(eventAmount);
  const relatedPayPalOrderId = event.resource.supplementary_data?.related_ids?.order_id;

  // 1) Primary match — the capture id was already recorded on the order
  //    (the capture endpoint finished first).
  let order = await orderModel.findOne({ paypalCaptureId: captureId });
  let reconciled = false;

  // 2) Safe reconciliation — the webhook raced ahead of the capture
  //    endpoint's DB write, or the order row appeared late: match the PayPal
  //    order id from the signed event, then adopt it only after full
  //    verification below.
  if (!order && relatedPayPalOrderId) {
    const candidate = await orderModel.findOne({ paypalOrderId: relatedPayPalOrderId });
    if (candidate) {
      if (candidate.paypalCaptureId && candidate.paypalCaptureId !== captureId) {
        // The verified capture does not belong to this order — never graft an
        // unrelated capture onto an order.
        return {
          unresolved: true,
          httpStatus: 200, // deterministic — retrying cannot fix an identity mismatch
          success: true,
          message: 'Capture does not belong to the referenced order; flagged for review',
          result: WEBHOOK_RESULTS.CAPTURE_ORDER_MISMATCH,
          note: `capture ${captureId} does not belong to order with paypalOrderId ${relatedPayPalOrderId}`,
          alert: {
            reason: 'capture_order_mismatch',
            details: {
              eventId: event.id,
              captureId,
              relatedPayPalOrderId,
              orderDbId: candidate._id,
            },
          },
        };
      }
      order = candidate;
      reconciled = true;
    }
  }

  if (order) {
    // Verify amount + currency against the expected payment BEFORE any write.
    const orderCents = Math.round(order.total * 100);
    if (eventCurrency !== order.currency.toUpperCase() || eventCents !== orderCents) {
      return {
        unresolved: true,
        httpStatus: 200, // deterministic — retrying cannot fix a mismatch
        success: true,
        message: 'Capture amount or currency does not match the order; flagged for review',
        result: WEBHOOK_RESULTS.AMOUNT_CURRENCY_MISMATCH,
        note: `event ${eventAmount} ${eventCurrency} vs order ${order.total} ${order.currency}`,
        alert: {
          reason: 'amount_currency_mismatch',
          details: {
            eventId: event.id,
            captureId,
            eventAmount,
            eventCurrency,
            orderTotal: order.total,
            orderCurrency: order.currency,
            orderDbId: order._id,
          },
        },
      };
    }

    // Never clobber a refunded order. Completing pending/failed orders is
    // idempotent; a completed order missing its capture id gets a safe
    // backfill of the (verified) capture reference.
    await orderModel.updateOne(
      {
        _id: order._id,
        $or: [
          { paymentStatus: { $in: ['pending', 'failed'] } },
          { paypalCaptureId: null },
        ],
      },
      {
        $set: {
          paymentStatus: 'completed',
          paypalCaptureId: captureId,
          paypalTransactionId: captureId,
        },
      }
    );

    return {
      unresolved: false,
      result: reconciled ? WEBHOOK_RESULTS.ORDER_UPDATED_RECONCILED : WEBHOOK_RESULTS.ORDER_UPDATED,
    };
  }

  // 3) Unmatched — no order references this capture. Delayed order creation
  //    is still possible, so do NOT acknowledge: retry within the bounded
  //    budget; alert for manual reconciliation once it is spent.
  const maxAttempts = getWebhookMaxUnmatchedAttempts();
  if (record.attempts < maxAttempts) {
    console.warn(
      `🔔 PayPal webhook deferred: no matching order for capture ${captureId}` +
        `${relatedPayPalOrderId ? ` (paypal order ${relatedPayPalOrderId})` : ''}` +
        ` — attempt ${record.attempts}/${maxAttempts}, awaiting retry (event=${event.id})`
    );
    return {
      unresolved: true,
      httpStatus: 500, // ask PayPal to retry — the order may appear yet
      success: false,
      message: 'No matching order yet; event left unresolved for retry',
      result: WEBHOOK_RESULTS.NO_MATCHING_ORDER,
      note:
        `no order matched capture ${captureId}` +
        `${relatedPayPalOrderId ? ` (paypal order ${relatedPayPalOrderId})` : ''}` +
        `; awaiting retry (attempt ${record.attempts}/${maxAttempts})`,
      alert: null,
    };
  }

  return {
    unresolved: true,
    httpStatus: 200, // budget spent — stop the retry storm; ops reconciles manually
    success: true,
    message: `No matching order after ${maxAttempts} attempts; flagged for manual reconciliation`,
    result: WEBHOOK_RESULTS.NO_MATCHING_ORDER_RETRY_EXHAUSTED,
    note: `no order matched capture ${captureId} after ${record.attempts} attempts`,
    alert: {
      reason: 'no_matching_order_retry_exhausted',
      details: {
        eventId: event.id,
        captureId,
        relatedPayPalOrderId: relatedPayPalOrderId || null,
        attempts: record.attempts,
        maxAttempts,
      },
    },
  };
}

const handlePayPalWebhook = async (req, res) => {
  let acquiredRecord = null;
  try {
    const event = req.body;

    // 1. Structural validation — reject malformed payloads immediately.
    if (!event || typeof event !== 'object' || !event.id || !event.event_type) {
      return res.status(400).json({ success: false, message: 'Malformed webhook event' });
    }

    // 2. Signature verification via PayPal's verify-webhook-signature API.
    //    FAIL-CLOSED: missing/invalid signature data means the event is
    //    untrusted and must never touch payment or order records.
    const verifier = getActiveWebhookVerifier();
    const verification = await verifier.verify({
      headers: req.headers,
      rawBody: req.rawBody,
      event,
    });

    if (!verification.verified) {
      console.warn(
        `🔔 PayPal webhook rejected (${verification.reason || 'signature invalid'}) event=${event.id} type=${event.event_type}`
      );
      return res
        .status(400)
        .json({ success: false, message: 'Webhook signature verification failed' });
    }

    // 3. Validate the capture resource BEFORE any database write, so a
    //    malformed body can never strand an event record in 'processing'.
    //    Amount + currency are required for capture events — they are what the
    //    expected-payment verification in processCaptureCompletedEvent checks.
    const captureId = event.resource?.id;
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      if (!captureId) {
        return res.status(400).json({ success: false, message: 'Malformed capture resource' });
      }
      const amount = event.resource.amount;
      const hasValidAmount =
        amount &&
        typeof amount.value === 'string' &&
        Number.isFinite(parseAmountToCents(amount.value)) &&
        typeof amount.currency_code === 'string' &&
        amount.currency_code.length === 3;
      if (!hasValidAmount) {
        return res
          .status(400)
          .json({ success: false, message: 'Malformed capture amount or currency' });
      }
    }

    // 4. Atomic acquisition of the event (unique eventId index).
    const lockMs = getWebhookProcessingLockMs();
    const staleBefore = new Date(Date.now() - lockMs);
    const acquireFilter = {
      eventId: event.id,
      $or: [
        { status: WEBHOOK_EVENT_STATUSES.FAILED },
        { status: WEBHOOK_EVENT_STATUSES.UNRESOLVED },
        { status: WEBHOOK_EVENT_STATUSES.PROCESSING, updatedAt: { $lt: staleBefore } },
        { status: { $exists: false } }, // legacy pre-state-machine records
      ],
    };

    try {
      acquiredRecord = await webhookEventModel.create({
        eventId: event.id,
        eventType: event.event_type,
        resourceId: event.resource?.id,
        status: WEBHOOK_EVENT_STATUSES.PROCESSING,
        attempts: 1,
      });
    } catch (createError) {
      const isDuplicate =
        createError?.code === 11000 || /duplicate key/.test(String(createError?.message));
      if (!isDuplicate) throw createError;

      // This delivery is a retry/concurrent duplicate — re-acquire unless the
      // event is already completed or a live lock is held by another worker.
      acquiredRecord = await webhookEventModel.findOneAndUpdate(
        acquireFilter,
        {
          $set: { status: WEBHOOK_EVENT_STATUSES.PROCESSING, updatedAt: new Date() },
          $inc: { attempts: 1 },
        },
        { new: true }
      );

      if (!acquiredRecord) {
        const existing = await webhookEventModel.findOne({ eventId: event.id }).lean();
        if (existing?.status === WEBHOOK_EVENT_STATUSES.COMPLETED) {
          // Fully processed earlier — acknowledge so PayPal stops retrying.
          return res.status(200).json({ success: true, message: 'Duplicate event ignored' });
        }
        // A fresh lock is held (another delivery is processing right now) —
        // do NOT acknowledge; respond 500 so PayPal retries later.
        return res
          .status(500)
          .json({ success: false, message: 'Event is currently being processed' });
      }
    }

    // 5. Process the verified, acquired event. The order update is idempotent
    //    (setting paymentStatus:'completed'), which is what makes safe
    //    re-processing of interrupted attempts possible.
    let processingResult;
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const outcome = await processCaptureCompletedEvent(event, acquiredRecord);

      if (outcome.unresolved) {
        // Final gate Task 6 — the event could NOT be safely applied: either it
        // stays retryable ('unresolved', HTTP 500 asks PayPal to redeliver —
        // covers delayed order creation and the capture-endpoint race), or it
        // is terminal (mismatch / retry budget exhausted: acknowledged to stop
        // retries, flagged for manual reconciliation with an alert).
        await markWebhookEventUnresolved(acquiredRecord._id, outcome);
        if (outcome.alert) {
          alertUnresolvedWebhook(outcome.alert.reason, outcome.alert.details);
        }
        return res
          .status(outcome.httpStatus)
          .json({ success: outcome.success, message: outcome.message });
      }

      processingResult = outcome.result;
    } else {
      processingResult = WEBHOOK_RESULTS.IGNORED_EVENT_TYPE;
    }

    await webhookEventModel.updateOne(
      { _id: acquiredRecord._id },
      {
        $set: {
          status: WEBHOOK_EVENT_STATUSES.COMPLETED,
          completedAt: new Date(),
          result: processingResult,
          lastError: null,
        },
      }
    );

    res.json({ success: true });
  } catch (error) {
    // Processing failed AFTER acquisition — mark failed so the next delivery
    // re-processes instead of being acknowledged as a duplicate (Task 1).
    if (acquiredRecord?._id) {
      await markWebhookEventFailed(acquiredRecord._id, error);
    }
    console.error(
      `PayPal webhook error (event=${req.body?.id || 'unknown'}):`,
      redactError(error)
    );
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and status are required'
      });
    }

    // Server-side whitelist — the same enum enforced by models/orderModel.js.
    // Route-level admin authorization is applied in routes/orderRoute.js.
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid order status. Allowed values: ${ORDER_STATUSES.join(', ')}`
      });
    }

    // I-3: cancelling a reserved order restores the reserved stock — exactly
    // once. `stockReserved` is cleared in the same atomic update, so a second
    // cancel (or a pre-fix order that never reserved) can never inflate stock.
    if (status === 'Cancelled') {
      const claimed = await orderModel.findOneAndUpdate(
        { _id: orderId, stockReserved: true },
        { $set: { stockReserved: false } },
        { new: true }
      );
      if (claimed) {
        for (const item of claimed.items) {
          if (isValidObjectId(item.productId)) {
            try {
              await productModel.updateOne(
                { _id: item.productId },
                [{ $set: { stockQuantity: { $add: ['$stockQuantity', item.quantity] }, inStock: true } }]
              );
            } catch (restoreError) {
              console.error('Stock restore failure:', redactError(restoreError));
            }
          }
        }
      }
    }

    const order = await orderModel.findByIdAndUpdate(
      orderId,
      { orderStatus: status },
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Send real-time notifications
    const orderWithUser = await orderModel.findById(orderId).populate('userId', 'name email');
    
    // Send order status update to all relevant parties
    socketService.sendOrderStatusUpdate(orderWithUser.toJSON());
    
    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: order.toJSON()
    });
    
  } catch (error) {
    console.error('Update status error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const userOrders = async (req, res) => {
  try {
    const userId = req.user?.id;

    console.log('🔍 UserOrders Debug:');
    console.log('  - User ID from token:', userId);
    console.log('  - Request method:', req.method);
    console.log('  - Request query:', req.query);
    
    if (!userId) {
      console.log('❌ No user ID found in token');
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }
    
    // Get pagination and filtering parameters from request body (POST) or query (GET)
    const { page: rawPage = 1, limit: rawLimit = 10, status } = req.method === 'POST' ? req.body : req.query;
    // Sanitize pagination: strings like 'abc' previously produced NaN skips;
    // limits are capped so a client cannot request the entire collection.
    const page = Math.min(10000, Math.max(1, parseInt(rawPage, 10) || 1));
    const limit = Math.min(100, Math.max(1, parseInt(rawLimit, 10) || 10));
    const skip = (page - 1) * limit;
    
    console.log('  - Pagination params:', { page, limit, status, skip });
    
    // Build query
    let query = { userId, isActive: true };
    if (status) {
      query.orderStatus = status;
    }
    
    console.log('  - Database query:', query);
    
    // Get total count for pagination
    const totalOrders = await orderModel.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / limit);
    
    console.log('  - Total orders found:', totalOrders);
    console.log('  - Total pages:', totalPages);
    
    // Get orders with pagination
    const orders = await orderModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    console.log('  - Orders returned:', orders.length);
    
    res.json({
      success: true,
      orders: orders.map(order => order.toJSON()),
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalOrders,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
    
  } catch (error) {
    console.error('User orders error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

const allOrders = async (req, res) => {
  try {
    // Get filtering and pagination parameters
    const { 
      page = 1, 
      limit = 20, 
      status, 
      paymentStatus, 
      userEmail,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    // Sanitize pagination (cap the page size — a client cannot pull the whole
    // collection in one request, and garbage input falls back to defaults).
    const safePage = Math.min(10000, Math.max(1, parseInt(page, 10) || 1));
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (safePage - 1) * safeLimit;
    
    // Build query
    let query = { isActive: true };
    
    if (status) {
      query.orderStatus = status;
    }
    
    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }
    
    // Date range filtering
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }
    
    // User email filtering (will be handled after population)
    let userEmailFilter = null;
    if (userEmail) {
      userEmailFilter = userEmail.toLowerCase();
    }
    
    // Build sort object
    const sortObject = {};
    sortObject[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // Get total count for pagination
    const totalOrders = await orderModel.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / parseInt(limit));
    
    // Get orders with population and filtering
    let orders = await orderModel.find(query)
      .populate('userId', 'name email')
      .sort(sortObject)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Apply user email filter after population
    if (userEmailFilter) {
      orders = orders.filter(order => 
        order.userId && 
        order.userId.email && 
        order.userId.email.toLowerCase().includes(userEmailFilter)
      );
    }
    
    // Get unique users for filtering dropdown
    const uniqueUsers = await orderModel.aggregate([
      { $match: { isActive: true } },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $group: { _id: '$user._id', name: { $first: '$user.name' }, email: { $first: '$user.email' } } },
      { $sort: { name: 1 } }
    ]);
    
    // Get order statistics
    const stats = await orderModel.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
          pendingOrders: { $sum: { $cond: [{ $eq: ['$orderStatus', 'Order Placed'] }, 1, 0] } },
          completedOrders: { $sum: { $cond: [{ $eq: ['$orderStatus', 'Delivered'] }, 1, 0] } },
          pendingPayments: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] } },
          completedPayments: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, 1, 0] } }
        }
      }
    ]);
    
    res.json({
      success: true,
      orders: orders.map(order => {
        const orderObj = order.toJSON();
        // Ensure user data is properly structured
        if (orderObj.userId && typeof orderObj.userId === 'object') {
          orderObj.user = orderObj.userId;
          delete orderObj.userId;
        }
        return orderObj;
      }),
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalOrders,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
        limit: parseInt(limit)
      },
      filters: {
        users: uniqueUsers,
        orderStatuses: ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'],
        paymentStatuses: ['pending', 'completed', 'failed', 'refunded']
      },
      stats: stats[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        pendingOrders: 0,
        completedOrders: 0,
        pendingPayments: 0,
        completedPayments: 0
      }
    });
    
  } catch (error) {
    console.error('All orders error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Debug endpoint to check orders (admin only).
// Phase 4: diagnostic endpoints are DISABLED in production unless explicitly
// opted back in with ENABLE_DEBUG_ENDPOINTS=true — this endpoint dumps order
// and customer PII with no operational purpose in production. Non-production
// (development/test/staging) keeps the admin-only behavior.
const debugOrders = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }

    const totalOrders = await orderModel.countDocuments();
    const recentOrders = await orderModel.find().sort({ createdAt: -1 }).limit(5);
    
    // Get users with orders
    const usersWithOrders = await userModel.find({ 
      orders: { $exists: true, $ne: [] } 
    }).select('name email orders').populate('orders', '_id paymentStatus orderStatus total createdAt');
    
    res.json({
      success: true,
      totalOrders,
      recentOrders: recentOrders.map(order => ({
        _id: order._id,
        userId: order.userId,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        total: order.total,
        createdAt: order.createdAt
      })),
      usersWithOrders: usersWithOrders.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        orderCount: user.orders.length,
        orders: user.orders
      }))
    });
    
  } catch (error) {
    console.error('Debug orders error:', redactError(error));
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

export { 
  placeOrder, 
  placeOrderPayPal,
  capturePayPalPayment,
  handlePayPalWebhook,
  updateStatus, 
  userOrders, 
  allOrders,
  debugOrders
};