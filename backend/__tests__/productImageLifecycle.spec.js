// Coverage-gap: productController addProduct/removeProduct had no functional
// spec — the image lifecycle (Cloudinary upload on create, destroy-on-remove,
// the no-images guard, upload-failure 500, and destroy-failure continuing the
// DB deletion) was only reachable in production against the real Cloudinary
// API. The setCloudinaryForTests seam (mirroring setPayPalClientForTests in
// orderController) lets these branches run offline against the REAL route
// stack (authAdmin -> multer -> express-validator -> controller).
//
// Defense-in-depth controller branches that express-validator makes
// unreachable through the route (missing-field 400, invalid-color 400) are
// intentionally NOT tested here — the middleware contract is pinned by
// adversarialInputValidation/injectionWebSecurity instead.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

import app from '../app.js';
import { startTestDb, stopTestDb, makeAdminToken } from './helpers.mjs';
import productModel from '../models/productModel.js';
import { setCloudinaryForTests } from '../controllers/productController.js';

let db;
let adminToken;
let uploadsBefore; // snapshot of uploads/ to clean up multer temp files
const uploadsDir = path.join(process.cwd(), 'uploads');

// 1x1 transparent PNG — passes multer's image/* + size filters.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// A Cloudinary-shaped URL: publicId extraction must yield
// 'ecommerce/products/<filename-without-extension>'.
const cdnUrl = (file) =>
  `https://res.cloudinary.com/demo/image/upload/v1717171717/ecommerce/products/${file}`;

function snapshotUploads() {
  try {
    return new Set(fs.readdirSync(uploadsDir));
  } catch {
    return new Set();
  }
}

function cleanupNewUploads(beforeSet) {
  try {
    for (const f of fs.readdirSync(uploadsDir)) {
      if (!beforeSet.has(f)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }
  } catch {
    /* best-effort cleanup only */
  }
}

beforeAll(async () => {
  db = await startTestDb();
  adminToken = makeAdminToken();
  uploadsBefore = snapshotUploads();
});

afterAll(async () => {
  setCloudinaryForTests(null); // never leak the override into other suites
  cleanupNewUploads(uploadsBefore);
  await stopTestDb(db);
});

const validFields = {
  name: 'Test Phone',
  description: 'A phone long enough for the validator (10+ chars).',
  price: '999.5',
  category: 'iPhone',
  subCategory: 'Pro',
  color: JSON.stringify(['Black', 'Silver']),
  bestseller: 'true',
  stockQuantity: '5',
};

describe('POST /api/product/add — image upload lifecycle', () => {
  it('returns 400 when no image files are attached (multer passes, controller guard fires)', async () => {
    const res = await request(app)
      .post('/api/product/add')
      .set('token', adminToken)
      .field('name', validFields.name)
      .field('description', validFields.description)
      .field('price', validFields.price)
      .field('category', validFields.category)
      .field('subCategory', validFields.subCategory)
      .field('color', validFields.color)
      .field('bestseller', validFields.bestseller)
      .field('stockQuantity', validFields.stockQuantity);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one product image/i);
  });

  it('creates the product (201) with Cloudinary secure URLs, color parsed, bestseller/stock coerced', async () => {
    const uploads = [];
    setCloudinaryForTests({
      uploader: {
        async upload(filePath) {
          uploads.push(filePath);
          return { secure_url: cdnUrl(`mock-${uploads.length}.png`) };
        },
        async destroy() { throw new Error('not expected in this test'); },
      },
    });

    const res = await request(app)
      .post('/api/product/add')
      .set('token', adminToken)
      .field('name', validFields.name)
      .field('description', validFields.description)
      .field('price', validFields.price)
      .field('category', validFields.category)
      .field('subCategory', validFields.subCategory)
      .field('color', validFields.color)
      .field('bestseller', validFields.bestseller)
      .field('stockQuantity', validFields.stockQuantity)
      .attach('image1', PNG, { filename: 'a.png', contentType: 'image/png' })
      .attach('image2', PNG, { filename: 'b.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // Field order preserved: image1, image2 -> mock-1, mock-2
    expect(res.body.product.image).toEqual([cdnUrl('mock-1.png'), cdnUrl('mock-2.png')]);
    // Both attached files were offered to the uploader exactly once
    expect(uploads).toHaveLength(2);

    const doc = await productModel.findById(res.body.product._id).lean();
    expect(doc.color).toEqual(['Black', 'Silver']); // JSON string -> array
    expect(doc.bestseller).toBe(true); // "true" -> boolean
    expect(doc.stockQuantity).toBe(5);
    expect(doc.inStock).toBe(true); // derived: stockQuantity > 0
  });

  it('returns 500 (no product saved) when the Cloudinary upload fails', async () => {
    setCloudinaryForTests({
      uploader: {
        async upload() { throw new Error('simulated cloudinary outage'); },
        async destroy() { throw new Error('unused'); },
      },
    });

    const res = await request(app)
      .post('/api/product/add')
      .set('token', adminToken)
      .field('name', validFields.name)
      .field('description', validFields.description)
      .field('price', validFields.price)
      .field('category', validFields.category)
      .field('subCategory', validFields.subCategory)
      .field('color', validFields.color)
      .field('bestseller', 'false')
      .field('stockQuantity', '0')
      .attach('image1', PNG, { filename: 'c.png', contentType: 'image/png' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/error uploading images/i);
    // Nothing persisted — the failed attempt must not leave a half-product.
    const count = await productModel.countDocuments({ name: validFields.name, stockQuantity: 0 });
    expect(count).toBe(0);
  });
});

describe('POST /api/product/remove — image destroy lifecycle', () => {
  it('returns 404 for a well-formed unknown id', async () => {
    const { Types } = await import('mongoose');
    const res = await request(app)
      .post('/api/product/remove')
      .set('token', adminToken)
      .send({ id: new Types.ObjectId().toString() });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/product not found/i);
  });

  it('deletes the product and destroys each image by its extracted publicId', async () => {
    const destroyed = [];
    setCloudinaryForTests({
      uploader: {
        async upload() { throw new Error('unused'); },
        async destroy(publicId) {
          destroyed.push(publicId);
          return { result: 'ok' };
        },
      },
    });

    const created = await productModel.create({
      name: 'Removal Target',
      description: 'Long enough description for the schema.',
      price: 10,
      image: [cdnUrl('xyz789.jpg'), cdnUrl('abc123.webp')],
      category: 'Mac',
      subCategory: 'Air',
      color: ['Silver'],
      bestseller: false,
      stockQuantity: 3,
      inStock: true,
    });

    const res = await request(app)
      .post('/api/product/remove')
      .set('token', adminToken)
      .send({ id: created._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // publicId = full folder path after the version segment, extension
    // stripped (K-13: the old last-two-segments extraction dropped the parent
    // folder and destroy() targeted a nonexistent asset):
    //   .../v<ver>/ecommerce/products/xyz789.jpg -> ecommerce/products/xyz789
    expect(destroyed.sort()).toEqual(['ecommerce/products/abc123', 'ecommerce/products/xyz789']);
    expect(await productModel.findById(created._id)).toBeNull();
  });

  it('still deletes the DB product when Cloudinary destroy fails (best-effort cleanup)', async () => {
    setCloudinaryForTests({
      uploader: {
        async upload() { throw new Error('unused'); },
        async destroy() { throw new Error('simulated destroy outage'); },
      },
    });

    const created = await productModel.create({
      name: 'Destroy-Failure Target',
      description: 'Long enough description for the schema.',
      price: 20,
      image: [cdnUrl('stuck.png')],
      category: 'Watch',
      subCategory: 'Ultra',
      color: ['Gold'],
      bestseller: false,
      stockQuantity: 1,
      inStock: true,
    });

    const res = await request(app)
      .post('/api/product/remove')
      .set('token', adminToken)
      .send({ id: created._id.toString() });

    expect(res.status).toBe(200); // destroy failure is swallowed, deletion proceeds
    expect(await productModel.findById(created._id)).toBeNull();
  });
});
