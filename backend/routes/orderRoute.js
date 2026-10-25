import { allOrders, placeOrder, placeOrderPayPal, capturePayPalPayment, handlePayPalWebhook, updateStatus, refundOrder, userOrders, debugOrders } from '../controllers/orderController.js';
import authUser, { authAdmin } from '../middleware/auth.js';
import { debugEndpointGuard } from '../middleware/debugGuard.js';

import express from 'express'

const orderRouter = express.Router();

orderRouter.post('/', authUser, placeOrder)
orderRouter.post('/paypal/create', authUser, placeOrderPayPal)
orderRouter.post('/paypal/capture', authUser, capturePayPalPayment)
orderRouter.post('/paypal/webhook', handlePayPalWebhook)
orderRouter.post('/userorders', authUser, userOrders)
// Admin-only order status updates (Phase 1 security work area 1).
// authAdmin rejects unauthenticated requests with 401 and authenticated
// non-admin requests with 403 — see middleware/auth.js.
orderRouter.put('/status', authAdmin, updateStatus)
// Refunds are an operator action: admin only, PayPal capture refunded through
// the gateway, COD/Card recorded as a manual (out-of-band) refund.
orderRouter.post('/refund', authAdmin, refundOrder)
orderRouter.get('/user', authUser, userOrders)
orderRouter.get('/all', authAdmin, allOrders) // Admin only - all user orders
// Debug endpoint exposes order/PII data — admin only (was unauthenticated).
// Phase 4: hidden entirely in production (404) via the debug guard, which
// runs BEFORE authAdmin so probes cannot distinguish the endpoint's existence.
orderRouter.get('/debug', debugEndpointGuard, authAdmin, debugOrders)

export default orderRouter;