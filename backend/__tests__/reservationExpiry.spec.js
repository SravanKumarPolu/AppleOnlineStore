// Inventory-hold expiry for abandoned PayPal checkouts, plus the money-safety
// guard for a capture that arrives after the hold was released.
//
// Before this change a PayPal order reserved stock at creation and NOTHING
// ever released it: an abandoned checkout took the item off sale permanently.
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { setActiveWebhookVerifier } from '../services/paypalWebhookService.js';
import { setPayPalClientForTests } from '../controllers/orderController.js';
import {
  releaseExpiredReservations,
  retryPendingRestorations,
  getReservationTtlMs,
  claimReservationRelease,
  restoreOrderInventory,
  restorationCreditId,
  reservationDebitId,
  releaseAbandonedReservations,
  creditReservedLine,
  ABANDONED_RESERVATION_MS,
} from '../services/reservationService.js';
import { startTestDb, stopTestDb, createTestUserDoc, makeUserToken } from './helpers.mjs';

let db;
let user;
let userToken;

const address = {
  firstName: 'Hold',
  lastName: 'Owner',
  email: 'hold@example.com',
  street: '1 Hold Street',
  city: 'Springfield',
  state: 'IL',
  zipcode: '62701',
  country: 'USA',
  phone: '5550100',
};

const makeProduct = (name) =>
  productModel.create({
    name,
    description: 'reservation expiry fixture',
    price: 25,
    image: ['https://example.com/hold.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: false,
    date: Date.now(),
    stockQuantity: 5,
    inStock: true,
  });

const makePayPalOrder = (product, overrides = {}) =>
  orderModel.create({
    userId: user._id,
    items: [
      {
        productId: String(product._id),
        name: product.name,
        image: 'https://example.com/hold.png',
        price: 25,
        quantity: 2,
        color: 'Black',
      },
    ],
    address,
    paymentMethod: 'PayPal',
    subtotal: 50,
    shipping: 10,
    total: 60,
    currency: 'USD',
    paymentStatus: 'pending',
    orderStatus: 'Order Placed',
    stockReserved: true,
    paypalOrderId: `PAYPAL-${Math.random().toString(36).slice(2, 10)}`,
    reservationExpiresAt: new Date(Date.now() - 60_000),
    ...overrides,
  });

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUserDoc('user');
  userToken = makeUserToken(user._id);
});

afterAll(async () => {
  setActiveWebhookVerifier(null);
  await stopTestDb(db);
});

describe('reservation expiry', () => {
  it('has a sane, configurable TTL', () => {
    expect(getReservationTtlMs({})).toBe(30 * 60 * 1000);
    expect(getReservationTtlMs({ PAYPAL_RESERVATION_TTL_MS: '900000' })).toBe(900000);
    expect(getReservationTtlMs({ PAYPAL_RESERVATION_TTL_MS: '-5' })).toBe(30 * 60 * 1000);
  });

  it('releases the hold of an expired unpaid PayPal order exactly once', async () => {
    const product = await makeProduct('Expired Hold');
    const order = await makePayPalOrder(product);

    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);

    const released = await releaseExpiredReservations();
    expect(released).toContain(String(order._id));

    const updated = await orderModel.findById(order._id);
    expect(updated.stockReserved).toBe(false);
    expect(updated.orderStatus).toBe('Cancelled');
    expect(updated.paymentStatus).toBe('failed');

    // 2 units returned to the catalog.
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);

    // Second sweep must not restore again.
    await releaseExpiredReservations();
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });

  it('leaves a live (not yet expired) hold untouched', async () => {
    const product = await makeProduct('Live Hold');
    const order = await makePayPalOrder(product, {
      reservationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await releaseExpiredReservations();

    const unchanged = await orderModel.findById(order._id);
    expect(unchanged.stockReserved).toBe(true);
    expect(unchanged.orderStatus).toBe('Order Placed');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);
  });

  it('never touches COD orders or already-paid orders', async () => {
    const product = await makeProduct('Not Applicable');
    const cod = await makePayPalOrder(product, {
      paymentMethod: 'COD',
      reservationExpiresAt: null,
    });
    const paid = await makePayPalOrder(product, { paymentStatus: 'completed' });

    await releaseExpiredReservations();

    expect((await orderModel.findById(cod._id)).stockReserved).toBe(true);
    expect((await orderModel.findById(paid._id)).stockReserved).toBe(true);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);
  });

  it('confirms a capture that arrives AFTER the hold was released instead of re-selling the item', async () => {
    const product = await makeProduct('Late Capture');
    const order = await makePayPalOrder(product);
    await releaseExpiredReservations();

    // The shopper paid late: PayPal delivers PAYMENT.CAPTURE.COMPLETED for the
    // cancelled order. Verify the webhook acknowledges it (no retry storm) but
    // never flips the order back to 'completed'.
    setActiveWebhookVerifier({ verify: async () => ({ verified: true }) });

    const captureId = 'CAPTURE-LATE-1';
    const response = await request(app)
      .post('/api/orders/paypal/webhook')
      .set('paypal-transmission-id', 'tid')
      .set('paypal-transmission-time', new Date().toISOString())
      .set('paypal-cert-url', 'https://example.com/cert')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .set('paypal-transmission-sig', 'sig')
      .send({
        id: `WH-LATE-${Date.now()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: captureId,
          amount: { value: '60.00', currency_code: 'USD' },
          supplementary_data: { related_ids: { order_id: order.paypalOrderId } },
        },
      });

    expect(response.status).toBe(200);

    const afterWebhook = await orderModel.findById(order._id);
    expect(afterWebhook.paymentStatus).toBe('failed'); // NOT silently completed
    expect(afterWebhook.orderStatus).toBe('Cancelled');
    expect(afterWebhook.paypalCaptureId).toBeFalsy();
  });
});

describe('durable inventory restoration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setPayPalClientForTests(null);
    setActiveWebhookVerifier(null);
  });

  it('keeps the obligation when a product credit fails, and retries it', async () => {
    const product = await makeProduct('Credit Failure');
    const order = await makePayPalOrder(product);

    // First credit attempt fails (transient write error).
    const original = productModel.findOneAndUpdate.bind(productModel);
    let failedOnce = false;
    jest.spyOn(productModel, 'findOneAndUpdate').mockImplementation((filter, update, options) => {
      if (!failedOnce && String(filter._id) === String(product._id)) {
        failedOnce = true;
        return Promise.reject(new Error('transient write failure'));
      }
      return original(filter, update, options);
    });

    await releaseExpiredReservations();

    const released = await orderModel.findById(order._id);
    expect(released.stockReserved).toBe(false); // claim held
    expect(released.orderStatus).toBe('Cancelled');
    // The units are NOT lost silently: the obligation is recorded and loud.
    expect(released.inventoryRestoration.status).toBe('reconciliation_required');
    expect(released.inventoryRestoration.attempts).toBe(1);
    expect(released.inventoryRestoration.lastError).toMatch(/transient write failure/i);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);

    jest.restoreAllMocks();

    const sweep = await retryPendingRestorations();
    expect(sweep.unresolved).toBe(0);

    const recovered = await orderModel.findById(order._id);
    expect(recovered.inventoryRestoration.status).toBe('completed');
    expect(recovered.inventoryRestoration.completedAt).toBeTruthy();
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);

    // Nothing left to retry, and the item is never credited twice.
    const again = await retryPendingRestorations();
    expect(again.retried).toBe(0);
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });

  it('restores each item at most once when only one item fails', async () => {
    const productA = await makeProduct('Multi A');
    const productB = await makeProduct('Multi B');
    const order = await makePayPalOrder(productA, {
      items: [
        {
          productId: String(productA._id),
          name: productA.name,
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 2,
          color: 'Black',
        },
        {
          productId: String(productB._id),
          name: productB.name,
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 1,
          color: 'Black',
        },
      ],
    });

    const original = productModel.findOneAndUpdate.bind(productModel);
    let failedB = false;
    jest.spyOn(productModel, 'findOneAndUpdate').mockImplementation((filter, update, options) => {
      if (!failedB && String(filter._id) === String(productB._id)) {
        failedB = true;
        return Promise.reject(new Error('B write failure'));
      }
      return original(filter, update, options);
    });

    await releaseExpiredReservations();
    expect((await productModel.findById(productA._id)).stockQuantity).toBe(7);
    expect((await productModel.findById(productB._id)).stockQuantity).toBe(5);
    expect((await orderModel.findById(order._id)).inventoryRestoration.status).toBe(
      'reconciliation_required'
    );

    jest.restoreAllMocks();
    await retryPendingRestorations();

    // Only B is retried; A keeps its single credit.
    expect((await productModel.findById(productA._id)).stockQuantity).toBe(7);
    expect((await productModel.findById(productB._id)).stockQuantity).toBe(6);
    expect((await orderModel.findById(order._id)).inventoryRestoration.status).toBe('completed');
  });

  it('settles an order whose product no longer exists without failing', async () => {
    const product = await makeProduct('Deleted Product');
    const order = await makePayPalOrder(product, {
      items: [
        {
          productId: String(product._id),
          name: product.name,
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 2,
          color: 'Black',
        },
        {
          productId: '64f1c2d3e4b5a69788776655', // never existed
          name: 'Ghost',
          image: 'https://example.com/hold.png',
          price: 25,
          quantity: 1,
          color: 'Black',
        },
      ],
    });

    await releaseExpiredReservations();

    const settled = await orderModel.findById(order._id);
    expect(settled.inventoryRestoration.status).toBe('completed');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });

  it('does not double-credit when the process dies after the credit but before the marker', async () => {
    const product = await makeProduct('Crash After Credit');
    const order = await makePayPalOrder(product); // 2 units

    // Model the crash window: the PRODUCT credit succeeds, then the order
    // bookkeeping write fails (a process death between the two writes).
    const original = orderModel.updateOne.bind(orderModel);
    let failedMarker = false;
    jest.spyOn(orderModel, 'updateOne').mockImplementation((filter, update, options) => {
      const sets = update?.$set || {};
      if (
        !failedMarker &&
        String(filter._id) === String(order._id) &&
        Object.keys(sets).some((key) => /^items\.\d+\.stockRestored$/.test(key))
      ) {
        failedMarker = true;
        return Promise.reject(new Error('simulated crash before marker'));
      }
      return original(filter, update, options);
    });

    await releaseExpiredReservations();

    const afterCrash = await orderModel.findById(order._id);
    expect(afterCrash.stockReserved).toBe(false);
    expect(afterCrash.inventoryRestoration.status).toBe('reconciliation_required');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);

    // The proof lives on the product, in the same atomic write as the credit.
    const ledger = await productModel
      .findById(product._id)
      .select('+restorationCredits');
    expect(ledger.restorationCredits).toContain(restorationCreditId(order._id, 0));

    jest.restoreAllMocks();
    await retryPendingRestorations();

    const recovered = await orderModel.findById(order._id);
    expect(recovered.inventoryRestoration.status).toBe('completed');
    expect(recovered.items[0].stockRestored).toBe(true);
    // The retry proves the credit from the ledger: no second increment.
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);
  });

  it('credits a line once when two restoration workers race', async () => {
    const product = await makeProduct('Concurrent Restoration');
    const order = await makePayPalOrder(product); // 2 units
    await claimReservationRelease(order._id); // release claimed, restoration pending

    const [first, second] = await Promise.all([
      orderModel.findById(order._id).lean(),
      orderModel.findById(order._id).lean(),
    ]);
    await Promise.all([restoreOrderInventory(first), restoreOrderInventory(second)]);

    const settledOrder = await orderModel.findById(order._id);
    expect(settledOrder.inventoryRestoration.status).toBe('completed');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(7);

    const ledger = await productModel
      .findById(product._id)
      .select('+restorationCredits');
    expect(
      ledger.restorationCredits.filter((id) => id === restorationCreditId(order._id, 0))
    ).toHaveLength(1);
  });

  it('does not expose the internal restoration ledger through the product API', async () => {
    const product = await makeProduct('Hidden Ledger');
    await makePayPalOrder(product);
    await releaseExpiredReservations();

    const response = await request(app)
      .post('/api/product/single')
      .send({ productId: String(product._id) });
    expect(response.status).toBe(200);
    expect(response.body.product.restorationCredits).toBeUndefined();
  });
});

describe('late PayPal capture', () => {
  const captureResult = {
    result: {
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            captures: [
              { id: 'CAPTURE-LATE-99', amount: { value: '60.00', currency_code: 'USD' } },
            ],
          },
        },
      ],
    },
  };

  afterEach(() => {
    setPayPalClientForTests(null);
  });

  it('refuses to capture a cancelled order before calling PayPal', async () => {
    const product = await makeProduct('Cancelled Capture');
    const order = await makePayPalOrder(product);
    await releaseExpiredReservations();

    let gatewayCalls = 0;
    setPayPalClientForTests({
      async execute() {
        gatewayCalls += 1;
        return captureResult;
      },
    });

    const response = await request(app)
      .post('/api/orders/paypal/capture')
      .set('token', userToken)
      .send({ orderID: order.paypalOrderId });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ORDER_NOT_PAYABLE');
    expect(gatewayCalls).toBe(0); // no money is taken for a dead order

    const unchanged = await orderModel.findById(order._id);
    expect(unchanged.paymentStatus).toBe('failed');
    expect(unchanged.orderStatus).toBe('Cancelled');
  });

  it('does not resurrect an order cancelled while the capture was in flight', async () => {
    const product = await makeProduct('In Flight Cancel');
    const order = await makePayPalOrder(product, { reservationExpiresAt: null });

    // Simulate the race: the cancel lands between the pre-flight check and the
    // write that would have marked the order paid.
    setPayPalClientForTests({
      async execute() {
        await orderModel.updateOne(
          { _id: order._id },
          { $set: { orderStatus: 'Cancelled', stockReserved: false } }
        );
        return captureResult;
      },
    });

    const response = await request(app)
      .post('/api/orders/paypal/capture')
      .set('token', userToken)
      .send({ orderID: order.paypalOrderId });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('CAPTURE_REQUIRES_RECONCILIATION');

    const after = await orderModel.findById(order._id);
    expect(after.paymentStatus).toBe('pending'); // NOT silently completed
    expect(after.orderStatus).toBe('Cancelled');
    // The capture reference is recorded so an operator can refund it.
    expect(after.paypalCaptureId).toBe('CAPTURE-LATE-99');
    expect((await productModel.findById(product._id)).stockQuantity).toBe(5);
  });
});

// §16.4.1 / K-21: the CREATION-TIME window (the restoration window above was
// already closed). Pre-K-21 `placeOrder` decremented products and only then
// inserted the order, so a process death in that gap destroyed units with no
// document to trace them. Now the draft is inserted first and every decrement
// carries a `<orderId>:<index>` marker in the SAME product update, so the state
// a crash leaves behind is always reconcilable.
//
// These tests reproduce the exact on-disk state each crash point leaves (the
// per-line write is the controller's own update, applied by hand) and assert
// that stock and the catalog converge — including under concurrent workers and
// a failing credit.
describe('creation-time stock reservation (crash safety)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setPayPalClientForTests(null);
    setActiveWebhookVerifier(null);
  });

  const draftFor = (
    lines,
    { ageMs = 5 * 60 * 1000, status = 'pending', stockReserved = false } = {}
  ) => {
    const subtotal = lines.reduce((sum, line) => sum + 25 * line.quantity, 0);
    return orderModel.create({
      userId: user._id,
      items: lines.map(({ product, quantity }) => ({
        productId: String(product._id),
        name: product.name,
        image: 'https://example.com/hold.png',
        price: 25,
        quantity,
        color: 'Black',
      })),
      address,
      paymentMethod: 'COD',
      subtotal,
      shipping: 10,
      total: subtotal + 10,
      currency: 'USD',
      paymentStatus: 'pending',
      orderStatus: 'Order Placed',
      stockReserved,
      stockReservation: { status, startedAt: new Date(Date.now() - ageMs) },
    });
  };

  // The exact single-product write `reserveOrderStock` performs per line.
  const debitLine = (order, index, product, quantity) =>
    productModel.findOneAndUpdate(
      {
        _id: product._id,
        inStock: true,
        stockQuantity: { $gte: quantity },
        reservationDebits: { $ne: reservationDebitId(order._id, index) },
      },
      {
        $inc: { stockQuantity: -quantity },
        $addToSet: { reservationDebits: reservationDebitId(order._id, index) },
      }
    );

  const stockOf = async (product) => (await productModel.findById(product._id)).stockQuantity;

  it('exposes a grace window so a live reservation is never swept', () => {
    expect(ABANDONED_RESERVATION_MS).toBeGreaterThan(0);
  });

  it('leaves a draft inside the grace window to the live request', async () => {
    const product = await makeProduct('Fresh Draft');
    const draft = await draftFor([{ product, quantity: 1 }], { ageMs: 0 });

    const released = await releaseAbandonedReservations();

    expect(released).not.toContain(String(draft._id));
    expect(await orderModel.findById(draft._id)).not.toBeNull();
    expect(await stockOf(product)).toBe(5);
  });

  it('removes a draft that died before any debit, without touching stock', async () => {
    const product = await makeProduct('Died Before Debit');
    const draft = await draftFor([{ product, quantity: 2 }]);

    const released = await releaseAbandonedReservations();

    expect(released).toContain(String(draft._id));
    expect(await orderModel.findById(draft._id)).toBeNull();
    expect(await stockOf(product)).toBe(5);
  });

  it('credits a draft that died after a partial debit — once, and only that line', async () => {
    const first = await makeProduct('Partial One');
    const second = await makeProduct('Partial Two');
    const draft = await draftFor([
      { product: first, quantity: 2 },
      { product: second, quantity: 1 },
    ]);

    await debitLine(draft, 0, first, 2); // line 0 applied, line 1 never reached
    expect(await stockOf(first)).toBe(3);
    expect(await stockOf(second)).toBe(5);

    const released = await releaseAbandonedReservations();
    expect(released).toContain(String(draft._id));

    expect(await stockOf(first)).toBe(5); // returned exactly once
    expect(await stockOf(second)).toBe(5); // never debited, so never credited
    expect(await orderModel.findById(draft._id)).toBeNull();

    const ledger = await productModel.findById(first._id).select('+reservationDebits +restorationCredits');
    expect(ledger.reservationDebits).toHaveLength(0); // debit claim consumed
    expect(ledger.restorationCredits).toEqual([reservationDebitId(draft._id, 0)]);
  });

  it('credits a draft that died after all debits but before the commit', async () => {
    const first = await makeProduct('All Debits One');
    const second = await makeProduct('All Debits Two');
    const draft = await draftFor([
      { product: first, quantity: 2 },
      { product: second, quantity: 1 },
    ]);

    await debitLine(draft, 0, first, 2);
    await debitLine(draft, 1, second, 1);
    expect(await stockOf(first)).toBe(3);
    expect(await stockOf(second)).toBe(4);

    await releaseAbandonedReservations();

    expect(await stockOf(first)).toBe(5);
    expect(await stockOf(second)).toBe(5);
    expect(await orderModel.findById(draft._id)).toBeNull();
  });

  it('never releases a committed reservation', async () => {
    const product = await makeProduct('Committed Hold');
    const draft = await draftFor([{ product, quantity: 1 }], {
      ageMs: 60 * 60 * 1000,
      status: 'reserved',
      stockReserved: true,
    });
    await debitLine(draft, 0, product, 1);

    await releaseAbandonedReservations();

    const stillHeld = await orderModel.findById(draft._id);
    expect(stillHeld).not.toBeNull();
    expect(stillHeld.stockReserved).toBe(true);
    expect(await stockOf(product)).toBe(4);
  });

  it('credits once when two sweeps race on the same draft', async () => {
    const product = await makeProduct('Concurrent Draft');
    const draft = await draftFor([{ product, quantity: 2 }]);
    await debitLine(draft, 0, product, 2);

    await Promise.all([releaseAbandonedReservations(), releaseAbandonedReservations()]);

    expect(await stockOf(product)).toBe(5); // 3 + 2, not 3 + 2 + 2
    const ledger = await productModel.findById(product._id).select('+restorationCredits');
    expect(ledger.restorationCredits).toHaveLength(1);
    expect(await orderModel.findById(draft._id)).toBeNull();
  });

  it('keeps the draft and retries when a credit write fails', async () => {
    const product = await makeProduct('Credit Retry');
    const draft = await draftFor([{ product, quantity: 1 }]);
    await debitLine(draft, 0, product, 1);
    expect(await stockOf(product)).toBe(4);

    const original = productModel.findOneAndUpdate.bind(productModel);
    let failedOnce = false;
    jest.spyOn(productModel, 'findOneAndUpdate').mockImplementation((filter, update, options) => {
      if (!failedOnce && filter.reservationDebits) {
        failedOnce = true;
        return Promise.reject(new Error('transient write failure'));
      }
      return original(filter, update, options);
    });

    await releaseAbandonedReservations();

    const owed = await orderModel.findById(draft._id);
    expect(owed).not.toBeNull(); // NOT deleted while units are still owed
    expect(owed.stockReservation.status).toBe('failed');
    expect(await stockOf(product)).toBe(4);

    jest.restoreAllMocks();
    await releaseAbandonedReservations();

    expect(await stockOf(product)).toBe(5);
    expect(await orderModel.findById(draft._id)).toBeNull();
  });

  it('hides the debit ledger from the product API', async () => {
    const product = await makeProduct('Hidden Debits');
    const draft = await draftFor([{ product, quantity: 1 }]);
    await debitLine(draft, 0, product, 1);

    const response = await request(app)
      .post('/api/product/single')
      .send({ productId: String(product._id) });

    expect(response.status).toBe(200);
    expect(response.body.product.reservationDebits).toBeUndefined();
  });

  it('a real checkout commits the reservation and records its debit marker', async () => {
    const product = await makeProduct('Committed Checkout');

    const response = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({
        items: [{ productId: String(product._id), quantity: 2, color: 'Black' }],
        address,
        paymentMethod: 'COD',
      });

    expect(response.status).toBe(200);
    expect(response.body.order.stockReserved).toBe(true);
    expect(response.body.order.stockReservation.status).toBe('reserved');

    const stored = await orderModel.findById(response.body.order._id);
    expect(stored.stockReserved).toBe(true);
    expect(stored.stockReservation.completedAt).toBeTruthy();

    const debited = await productModel.findById(product._id).select('+reservationDebits');
    expect(debited.stockQuantity).toBe(3);
    expect(debited.reservationDebits).toEqual([reservationDebitId(stored._id, 0)]);
  });

  it('a checkout that cannot reserve leaves no order and no stock change', async () => {
    const product = await makeProduct('Too Few Units');

    const response = await request(app)
      .post('/api/orders')
      .set('token', userToken)
      .send({
        items: [{ productId: String(product._id), quantity: 6, color: 'Black' }],
        address,
        paymentMethod: 'COD',
      });
    expect(response.status).toBe(400);

    expect(await stockOf(product)).toBe(5);

    // No draft survives a clean failure: the shopper's answer is the same as
    // before K-21 (no order), and nothing is owed to the catalog.
    const ordersForProduct = await orderModel.countDocuments({
      'items.productId': String(product._id),
    });
    expect(ordersForProduct).toBe(0);
  });

  it('credits a line only once when the same debit is released twice', async () => {
    const product = await makeProduct('Double Release');
    const draft = await draftFor([{ product, quantity: 2 }]);
    const debitId = reservationDebitId(draft._id, 0);
    await debitLine(draft, 0, product, 2);

    const first = await creditReservedLine(product._id, 2, debitId);
    const second = await creditReservedLine(product._id, 2, debitId);

    expect(first.applied).toBe(true);
    expect(second.settled).toBe(true);
    expect(await stockOf(product)).toBe(5);
  });
});
