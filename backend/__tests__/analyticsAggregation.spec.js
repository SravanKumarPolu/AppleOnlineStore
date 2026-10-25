// Traceability-matrix gap: "Analytics tracking + admin reads" was untested
// (only the surrounding authz middleware was covered). Pins:
//   - POST /api/analytics/track-activity persistence (user context required)
//   - GET /api/analytics/sales — summary/payment/status/daily aggregations
//   - GET /api/analytics/products — top products + rollup stats
//   - GET /api/analytics/user-behavior — activity/active-user rollups
//   - GET /api/analytics/search — popular searches + search stats
//   - GET /api/analytics/dashboard-summary — today/month/totals/recent/low-stock
//
// K-12 (FIXED 2026-10-24): the sales endpoint's categoryBreakdown $lookup
// used to join order items' productId (stored as STRING per
// orderModel.orderItemSchema) against products._id (ObjectId) — the BSON
// type mismatch meant the join never matched and categoryBreakdown was
// always []. The aggregation now normalizes the join key to ObjectId first
// ($convert with onError/onNull null), so the breakdown aggregates real
// product categories. These specs pin the fixed behavior.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';

import app from '../app.js';
import {
  startTestDb,
  stopTestDb,
  createTestUserDoc,
  createTestOrderDoc,
  makeUserToken,
  makeAdminToken,
} from './helpers.mjs';
import productModel from '../models/productModel.js';
import orderModel from '../models/orderModel.js';
import {
  UserActivity,
  ProductPerformance,
  SearchAnalytics,
} from '../models/analyticsModel.js';

let db;
let buyer;
let buyerToken;
let adminToken;
let productA; // iPhone, $100
let productB; // Mac, $50

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

beforeAll(async () => {
  db = await startTestDb();
  buyer = await createTestUserDoc('user');
  buyerToken = makeUserToken(buyer._id);
  adminToken = makeAdminToken('admin@test.local');

  productA = await productModel.create({
    name: 'iPhone 15 Pro',
    description: 'Flagship phone for analytics fixtures.',
    price: 100,
    image: ['https://example.com/a.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    date: Date.now(),
  });
  productB = await productModel.create({
    name: 'MacBook Air',
    description: 'Laptop for analytics fixtures.',
    price: 50,
    image: ['https://example.com/b.png'],
    category: 'Mac',
    subCategory: 'Air',
    color: ['Silver'],
    date: Date.now(),
  });
  await productModel.create({
    name: 'Low Stock Widget',
    description: 'Product with low stock for the dashboard.',
    price: 10,
    image: ['https://example.com/c.png'],
    category: 'Accessories',
    subCategory: 'Standard',
    color: ['Black'],
    date: Date.now(),
    stockQuantity: 5,
    inStock: true,
  });

  const itemFor = (product, price, quantity) => ({
    productId: String(product._id),
    name: product.name,
    image: product.image[0],
    price,
    quantity,
    color: 'Black',
  });

  // Two COMPLETED orders inside the query window (o1 PayPal, o2 COD)…
  await createTestOrderDoc(buyer._id, {
    items: [itemFor(productA, 100, 2)],
    paymentMethod: 'PayPal',
    paymentStatus: 'completed',
    subtotal: 200,
    total: 210,
  });
  await createTestOrderDoc(buyer._id, {
    items: [itemFor(productB, 50, 1)],
    paymentMethod: 'COD',
    paymentStatus: 'completed',
    subtotal: 50,
    total: 60,
  });
  // …one PENDING order inside the window (excluded from sales, kept for the
  // status breakdown)…
  await createTestOrderDoc(buyer._id, {
    items: [itemFor(productA, 100, 1)],
    paymentMethod: 'PayPal',
    paymentStatus: 'pending',
    subtotal: 100,
    total: 110,
  });
  // …one COMPLETED order dated 40 days ago (outside the window)…
  const old = await createTestOrderDoc(buyer._id, {
    items: [itemFor(productA, 100, 1)],
    paymentMethod: 'PayPal',
    paymentStatus: 'completed',
    subtotal: 100,
    total: 110,
  });
  await mongoose.connection.db.collection('orders').updateOne(
    { _id: old._id },
    { $set: { createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) } }
  );
  // …and one COMPLETED but soft-deleted (isActive false) order.
  await createTestOrderDoc(buyer._id, {
    items: [itemFor(productB, 50, 1)],
    paymentMethod: 'COD',
    paymentStatus: 'completed',
    subtotal: 50,
    total: 60,
    isActive: false,
  });

  // Product performance fixtures (real ObjectId refs — this pipeline works).
  await ProductPerformance.updateProductMetrics(productA._id, {
    views: 3,
    revenue: 100,
  });
  await ProductPerformance.updateProductMetrics(productB._id, {
    views: 1,
    revenue: 50,
  });

  // Search fixtures: 'iphone' searched twice, 'mac' once.
  await SearchAnalytics.trackSearch('iphone', 3);
  await SearchAnalytics.trackSearch('iphone', 3);
  await SearchAnalytics.trackSearch('mac', 1);
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('/api/analytics — authorization (protect + admin)', () => {
  it('rejects unauthenticated reads with 401', async () => {
    const res = await request(app).get('/api/analytics/sales');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects regular shopper tokens with 403', async () => {
    const res = await request(app)
      .get('/api/analytics/sales')
      .set('token', buyerToken);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin/i);
  });
});

describe('POST /api/analytics/track-activity — activity tracking', () => {
  it('persists an activity for the authenticated user (200)', async () => {
    const before = await UserActivity.countDocuments();

    const res = await request(app)
      .post('/api/analytics/track-activity')
      .set('token', buyerToken)
      .set('User-Agent', 'jest-agent/1.0')
      .send({ action: 'view_product', productId: String(productA._id), category: 'iPhone' });

    expect(res.status).toBe(200);
    expect(await UserActivity.countDocuments()).toBe(before + 1);

    const doc = await UserActivity.findOne({ userId: buyer._id, action: 'view_product' });
    expect(doc).toBeTruthy();
    expect(String(doc.productId)).toBe(String(productA._id));
    expect(doc.userAgent).toBe('jest-agent/1.0');
  });

  it('rejects admin tokens with 403 (Phase 3 fix: authUser refuses admin tokens before the controller)', async () => {
    const res = await request(app)
      .post('/api/analytics/track-activity')
      .set('token', adminToken)
      .send({ action: 'login' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin tokens cannot access shopper endpoints/i);
  });
});

describe('GET /api/analytics/sales — sales aggregation (admin)', () => {
  it('aggregates only completed, active orders inside the window', async () => {
    const res = await request(app)
      .get('/api/analytics/sales')
      .query({ startDate: iso(-24 * 3600 * 1000), endDate: iso(3600 * 1000) })
      .set('token', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    // Summary: 210 + 60 across 2 completed orders. NOTE: totalProducts counts
    // item LINES ($size: items), not units — one line of qty 2 + one line of
    // qty 1 = 2.
    expect(data.summary).toMatchObject({
      totalSales: 270,
      totalOrders: 2,
      averageOrderValue: 135,
      totalProducts: 2,
    });

    // One daily bucket (both orders created "today").
    expect(data.salesData).toHaveLength(1);
    expect(data.salesData[0]).toMatchObject({
      totalSales: 270,
      totalOrders: 2,
      totalProducts: 2,
      averageOrderValue: 135,
    });

    // Payment breakdown covers both completed orders by method.
    const byMethod = Object.fromEntries(
      data.paymentBreakdown.map((row) => [row._id, row])
    );
    expect(byMethod.PayPal).toEqual({ _id: 'PayPal', count: 1, total: 210 });
    expect(byMethod.COD).toEqual({ _id: 'COD', count: 1, total: 60 });

    // Status breakdown ignores paymentStatus: the pending order counts too.
    const byStatus = Object.fromEntries(
      data.statusBreakdown.map((row) => [row._id, row.count])
    );
    expect(byStatus['Order Placed']).toBe(3);

    // K-12 (fixed): the $lookup now normalizes the string productId to an
    // ObjectId before joining, so the breakdown aggregates real product
    // categories — order o1 is iPhone 15 Pro x2 ($200, one order, 2 units)
    // and o2 is MacBook Air x1 ($50, one order, 1 unit). The out-of-window,
    // pending and soft-deleted orders contribute nothing.
    expect(data.categoryBreakdown).toHaveLength(2);
    const byCategory = Object.fromEntries(
      data.categoryBreakdown.map((row) => [row.category, row])
    );
    expect(byCategory.iPhone).toMatchObject({ sales: 200, orders: 1, products: 2 });
    expect(byCategory.Mac).toMatchObject({ sales: 50, orders: 1, products: 1 });
  });

  it('skips order items whose productId is not a valid ObjectId instead of failing (K-12 robustness)', async () => {
    // Legacy/dirty data: a COMPLETED, in-window order whose item carries a
    // non-ObjectId productId. The item passes the $match and genuinely
    // reaches the join, where the $convert normalization must swallow it
    // (onError null) rather than 500 the whole sales report. Proof it was
    // counted by the summary (3 completed orders) while the category
    // breakdown stays clean (the garbage id cannot join any product).
    const ghost = await createTestOrderDoc(buyer._id, {
      items: [
        {
          productId: 'not-an-objectid',
          name: 'Ghost Product',
          image: 'https://example.com/ghost.png',
          price: 42,
          quantity: 1,
          color: 'Black',
        },
      ],
      paymentMethod: 'COD',
      paymentStatus: 'completed',
      subtotal: 42,
      total: 52,
    });

    try {
      const res = await request(app)
        .get('/api/analytics/sales')
        .query({ startDate: iso(-24 * 3600 * 1000), endDate: iso(3600 * 1000) })
        .set('token', adminToken);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // The ghost order IS part of the overall summary…
      expect(res.body.data.summary).toMatchObject({
        totalSales: 322,
        totalOrders: 3,
      });
      // …but its garbage productId never joins, so the category breakdown
      // still reports only the two real product categories, unchanged.
      const byCategory = Object.fromEntries(
        res.body.data.categoryBreakdown.map((row) => [row.category, row])
      );
      expect(Object.keys(byCategory).sort()).toEqual(['Mac', 'iPhone']);
      expect(byCategory.iPhone).toMatchObject({ sales: 200, orders: 1, products: 2 });
      expect(byCategory.Mac).toMatchObject({ sales: 50, orders: 1, products: 1 });
    } finally {
      // Remove the ghost order so the dashboard-summary describe (which
      // asserts today/month totals of 270) stays untouched.
      await orderModel.findByIdAndDelete(ghost._id);
    }
  });
});

describe('GET /api/analytics/products — product performance (admin)', () => {
  it('ranks top products by the requested metric and rolls up totals', async () => {
    const res = await request(app)
      .get('/api/analytics/products')
      .query({ metric: 'revenue' })
      .set('token', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    expect(data.topProducts).toHaveLength(2);
    expect(String(data.topProducts[0].productId._id)).toBe(String(productA._id));
    expect(data.topProducts[0].productId.name).toBe('iPhone 15 Pro');
    expect(data.topProducts[0].revenue).toBe(100);

    expect(data.productStats).toMatchObject({
      totalViews: 4,
      totalAddToCart: 0,
      totalPurchases: 0,
      totalRevenue: 150,
    });

    const byCategory = Object.fromEntries(
      data.categoryPerformance.map((row) => [row._id, row])
    );
    expect(byCategory.iPhone).toMatchObject({ totalViews: 3, totalRevenue: 100 });
    expect(byCategory.Mac).toMatchObject({ totalViews: 1, totalRevenue: 50 });
  });
});

describe('GET /api/analytics/user-behavior — activity rollups (admin)', () => {
  it('groups tracked activities by action and names the most active users', async () => {
    // Two more activities so the breakdown has distinct counts.
    await request(app)
      .post('/api/analytics/track-activity')
      .set('token', buyerToken)
      .send({ action: 'add_to_cart', productId: String(productA._id) });
    await request(app)
      .post('/api/analytics/track-activity')
      .set('token', buyerToken)
      .send({ action: 'add_to_cart', productId: String(productA._id) });

    const res = await request(app)
      .get('/api/analytics/user-behavior')
      .query({ startDate: iso(-24 * 3600 * 1000), endDate: iso(3600 * 1000) })
      .set('token', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    const byAction = Object.fromEntries(
      data.activityBreakdown.map((row) => [row._id, row.count])
    );
    expect(byAction['view_product']).toBe(1);
    expect(byAction['add_to_cart']).toBe(2);

    expect(data.activeUsers.length).toBeGreaterThanOrEqual(1);
    expect(data.activeUsers[0]).toMatchObject({
      name: buyer.name,
      email: buyer.email,
    });
    expect(data.activeUsers[0].activityCount).toBeGreaterThanOrEqual(3);
  });
});

describe('GET /api/analytics/search — search analytics (admin)', () => {
  it('returns popular searches sorted by count with summary statistics', async () => {
    const res = await request(app)
      .get('/api/analytics/search')
      .set('token', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    expect(data.popularSearches[0].query).toBe('iphone');
    expect(data.popularSearches[0].count).toBe(2);

    expect(data.searchStats).toMatchObject({
      totalSearches: 3,
      uniqueQueries: 2,
      averageResults: 2,
    });
  });
});

describe('GET /api/analytics/dashboard-summary — admin dashboard (admin)', () => {
  it('summarizes today/month, totals, recent orders, and low stock', async () => {
    const res = await request(app)
      .get('/api/analytics/dashboard-summary')
      .set('token', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    // The two completed orders were created moments ago -> today AND month.
    expect(data.today).toMatchObject({ sales: 270, orders: 2 });
    expect(data.month).toMatchObject({ sales: 270, orders: 2, averageOrderValue: 135 });

    expect(data.totalUsers).toBeGreaterThanOrEqual(1);
    expect(data.totalProducts).toBeGreaterThanOrEqual(3);

    expect(data.recentOrders.length).toBeGreaterThanOrEqual(3);
    expect(data.recentOrders[0].userId).toMatchObject({
      name: buyer.name,
      email: buyer.email,
    });

    const lowStockNames = data.lowStockProducts.map((p) => p.name);
    expect(lowStockNames).toContain('Low Stock Widget');
  });
});
