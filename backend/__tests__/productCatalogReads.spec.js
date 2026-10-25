// Traceability-matrix gap: "Product list/search/single (productController)"
// had no backend spec — the storefront rendering was covered by frontend
// vitest, but the query/filter/pagination contract itself was unpinned.
// Also pins the as-built analytics side-effect behavior of the PUBLIC read
// routes (no auth middleware -> req.user is never set -> no tracking docs).
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';

import app from '../app.js';
import { startTestDb, stopTestDb } from './helpers.mjs';
import productModel from '../models/productModel.js';
import { UserActivity, SearchAnalytics } from '../models/analyticsModel.js';

let db;
let iphonePro; // iPhone, bestseller, in stock, NEWEST
let macbook; // Mac, in stock, OLDEST

async function makeProduct(overrides = {}) {
  const doc = await productModel.create({
    name: 'iPhone 15 Pro',
    description: 'The flagship phone with titanium body.',
    price: 999,
    image: ['https://example.com/iphone.png'],
    category: 'iPhone',
    subCategory: 'Pro',
    color: ['Black'],
    bestseller: false,
    date: Date.now(),
    stockQuantity: 10,
    inStock: true,
    ...overrides,
  });
  return doc;
}

beforeAll(async () => {
  db = await startTestDb();
  iphonePro = await makeProduct({
    name: 'iPhone 15 Pro',
    bestseller: true,
    date: Date.now() + 3000,
  });
  await makeProduct({
    name: 'iPhone 15',
    subCategory: 'Standard',
    color: ['Silver'],
    date: Date.now() + 2000,
  });
  macbook = await makeProduct({
    name: 'MacBook Air',
    description: 'The everyday laptop with all-day battery.',
    category: 'Mac',
    subCategory: 'Air',
    price: 1099,
    date: Date.now() + 1000,
  });
  await makeProduct({
    name: 'iPhone SE',
    subCategory: 'Standard',
    stockQuantity: 0,
    inStock: false,
    date: Date.now(),
  });
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('GET /api/product/list — catalog reads', () => {
  it('returns products with pagination metadata (public, no auth required)', async () => {
    const res = await request(app).get('/api/product/list');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products).toHaveLength(4);
    expect(res.body.pagination).toMatchObject({
      currentPage: 1,
      totalPages: 1,
      totalProducts: 4,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it('sorts by date descending (newest product first) and paginates', async () => {
    const page1 = await request(app).get('/api/product/list?limit=2&page=1');
    expect(page1.status).toBe(200);
    expect(page1.body.products.map((p) => p.name)).toEqual(['iPhone 15 Pro', 'iPhone 15']);
    expect(page1.body.pagination).toMatchObject({
      currentPage: 1,
      totalPages: 2,
      totalProducts: 4,
      hasNextPage: true,
      hasPrevPage: false,
    });

    const page2 = await request(app).get('/api/product/list?limit=2&page=2');
    expect(page2.body.products.map((p) => p.name)).toEqual(['MacBook Air', 'iPhone SE']);
    expect(page2.body.pagination).toMatchObject({
      currentPage: 2,
      hasNextPage: false,
      hasPrevPage: true,
    });
  });

  it('filters by category', async () => {
    const res = await request(app).get('/api/product/list?category=iPhone');
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(3);
    expect(res.body.products.every((p) => p.category === 'iPhone')).toBe(true);
  });

  it('filters by bestseller and by stock status', async () => {
    const best = await request(app).get('/api/product/list?bestseller=true');
    expect(best.body.products).toHaveLength(1);
    expect(best.body.products[0].name).toBe('iPhone 15 Pro');

    const outOfStock = await request(app).get('/api/product/list?inStock=false');
    expect(outOfStock.body.products).toHaveLength(1);
    expect(outOfStock.body.products[0].name).toBe('iPhone SE');
  });

  it('searches name and description case-insensitively', async () => {
    const res = await request(app).get('/api/product/list?search=IPHONE');
    expect(res.status).toBe(200);
    const names = res.body.products.map((p) => p.name);
    expect(names).toContain('iPhone 15 Pro');
    expect(names).toContain('iPhone 15');
    expect(names).toContain('iPhone SE');
    expect(names).not.toContain('MacBook Air');

    const byDescription = await request(app).get('/api/product/list?search=battery');
    expect(byDescription.body.products.map((p) => p.name)).toEqual(['MacBook Air']);
  });

  it('returns an empty page for a search with no matches', async () => {
    const res = await request(app).get('/api/product/list?search=widget');
    expect(res.status).toBe(200);
    expect(res.body.products).toEqual([]);
    expect(res.body.pagination.totalProducts).toBe(0);
  });

  it('records NO analytics for public searches (as-built: tracking needs an authenticated req.user)', async () => {
    const before = await UserActivity.countDocuments();
    const beforeSearch = await SearchAnalytics.countDocuments();

    await request(app).get('/api/product/list?search=iphone');

    expect(await UserActivity.countDocuments()).toBe(before);
    expect(await SearchAnalytics.countDocuments()).toBe(beforeSearch);
  });
});

describe('POST /api/product/single — product detail', () => {
  it('returns a product by id', async () => {
    const res = await request(app)
      .post('/api/product/single')
      .send({ productId: String(iphonePro._id) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(String(res.body.product._id)).toBe(String(iphonePro._id));
    expect(res.body.product.name).toBe('iPhone 15 Pro');
  });

  it('returns 404 for an unknown but well-formed id', async () => {
    const unknown = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/product/single')
      .send({ productId: String(unknown) });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  it('returns 400 for a malformed id (isMongoId validation)', async () => {
    const res = await request(app)
      .post('/api/product/single')
      .send({ productId: 'not-an-object-id' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when productId is missing', async () => {
    const res = await request(app).post('/api/product/single').send({});

    expect(res.status).toBe(400);
  });

  it('records NO view analytics (as-built: public route, no user context)', async () => {
    const before = await UserActivity.countDocuments();
    await request(app)
      .post('/api/product/single')
      .send({ productId: String(macbook._id) });
    expect(await UserActivity.countDocuments()).toBe(before);
  });
});
