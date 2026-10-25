// Coverage-gap: categoryController had only getCategories/add(201) pinned —
// the functional CRUD contract of the six admin mutation handlers (duplicate
// rejection, case-insensitive matching, 404/400 guards, soft-delete, the
// subcategory lifecycle) was untested (categoryController sat at ~30% lines).
// These specs run through the REAL route stack (authAdmin-enforced per
// cartCategoryAddressAuthorization) against the in-memory DB.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { startTestDb, stopTestDb, makeAdminToken } from './helpers.mjs';
import categoryModel from '../models/categoryModel.js';

let db;
let adminToken;

beforeAll(async () => {
  db = await startTestDb();
  adminToken = makeAdminToken();
});

afterAll(async () => {
  await stopTestDb(db);
});

async function makeCategory(overrides = {}) {
  return categoryModel.create({
    name: `Cat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    description: 'seeded',
    subCategories: [],
    sortOrder: 0,
    isActive: true,
    ...overrides,
  });
}

describe('POST /api/category/add', () => {
  it('returns 400 when the name is missing', async () => {
    const res = await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ description: 'no name' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/name is required/i);
  });

  it('rejects a duplicate name case-insensitively', async () => {
    const uniq = `Electronics-${Math.floor(Math.random() * 1e6)}`;
    await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ name: uniq, description: 'original' });

    const res = await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({ name: uniq.toUpperCase(), description: 'imposter' }); // case-variant

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already exists/i);
    expect(await categoryModel.countDocuments({ name: uniq.toUpperCase() })).toBe(0);
  });

  it('creates with normalized subcategories (isActive default true, trimmed names)', async () => {
    const name = `Subcats-${Date.now()}`;
    const res = await request(app)
      .post('/api/category/add')
      .set('token', adminToken)
      .send({
        name,
        description: 'with subs',
        sortOrder: 2,
        subCategories: [
          { name: '  Pro  ', description: 'top tier' },
          { name: 'Air', description: '', isActive: false, sortOrder: 5 },
        ],
      });

    expect(res.status).toBe(201);
    const doc = await categoryModel.findOne({ name }).lean();
    expect(doc.subCategories).toHaveLength(2);
    expect(doc.subCategories[0]).toMatchObject({
      name: 'Pro',
      description: 'top tier',
      isActive: true, // default when not false
    });
    expect(doc.subCategories[1]).toMatchObject({ name: 'Air', isActive: false, sortOrder: 5 });
  });
});

describe('PUT /api/category/update', () => {
  it('returns 400 without categoryId', async () => {
    const res = await request(app)
      .put('/api/category/update')
      .set('token', adminToken)
      .send({ name: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category id is required/i);
  });

  it('returns 404 for an unknown but well-formed id', async () => {
    const { Types } = await import('mongoose');
    const res = await request(app)
      .put('/api/category/update')
      .set('token', adminToken)
      .send({ categoryId: new Types.ObjectId().toString(), name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('rejects renaming onto another category’s name (case-insensitive), excluding itself', async () => {
    const a = await makeCategory({ name: 'Alpha-Unique' });
    const b = await makeCategory({ name: 'Beta-Unique' });

    // b -> a's name: conflict
    const conflict = await request(app)
      .put('/api/category/update')
      .set('token', adminToken)
      .send({ categoryId: b._id.toString(), name: a.name.toUpperCase() });
    expect(conflict.status).toBe(400);
    expect(conflict.body.message).toMatch(/already exists/i);

    // a -> SAME name, different case: self-exclusion, no conflict, allowed
    const selfCase = await request(app)
      .put('/api/category/update')
      .set('token', adminToken)
      .send({ categoryId: a._id.toString(), name: a.name.toLowerCase() });
    expect(selfCase.status).toBe(200);
  });

  it('applies scalar updates and replaces subCategories when provided', async () => {
    const c = await makeCategory({ name: 'Update-Me', description: 'before' });
    const res = await request(app)
      .put('/api/category/update')
      .set('token', adminToken)
      .send({
        categoryId: c._id.toString(),
        description: 'after',
        sortOrder: 9,
        isActive: false,
        subCategories: [{ name: 'Fresh', description: 'new set' }],
      });

    expect(res.status).toBe(200);
    const doc = await categoryModel.findById(c._id).lean();
    expect(doc.description).toBe('after');
    expect(doc.sortOrder).toBe(9);
    expect(doc.isActive).toBe(false);
    expect(doc.subCategories.map((s) => s.name)).toEqual(['Fresh']);
  });
});

describe('DELETE /api/category/delete', () => {
  it('returns 400 without categoryId and 404 for unknown id', async () => {
    const noId = await request(app).delete('/api/category/delete').set('token', adminToken).send({});
    expect(noId.status).toBe(400);

    const { Types } = await import('mongoose');
    const ghost = await request(app)
      .delete('/api/category/delete')
      .set('token', adminToken)
      .send({ categoryId: new Types.ObjectId().toString() });
    expect(ghost.status).toBe(404);
  });

  it('soft-deletes: isActive=false, the document is retained', async () => {
    const c = await makeCategory();
    const res = await request(app)
      .delete('/api/category/delete')
      .set('token', adminToken)
      .send({ categoryId: c._id.toString() });

    expect(res.status).toBe(200);
    const doc = await categoryModel.findById(c._id).lean();
    expect(doc).not.toBeNull(); // retained
    expect(doc.isActive).toBe(false); // soft-deleted
  });
});

describe('subcategory lifecycle: /api/category/subcategory/*', () => {
  it('add: 400 missing fields, 404 unknown category, 409-style duplicate, 201 happy', async () => {
    const missing = await request(app)
      .post('/api/category/subcategory/add')
      .set('token', adminToken)
      .send({ categoryId: 'x' }); // no name
    expect(missing.status).toBe(400);

    const { Types } = await import('mongoose');
    const ghost = await request(app)
      .post('/api/category/subcategory/add')
      .set('token', adminToken)
      .send({ categoryId: new Types.ObjectId().toString(), name: 'Ghost' });
    expect(ghost.status).toBe(404);

    const c = await makeCategory();
    const first = await request(app)
      .post('/api/category/subcategory/add')
      .set('token', adminToken)
      .send({ categoryId: c._id.toString(), name: 'Pro', description: 'tier 1', sortOrder: 3 });
    expect(first.status).toBe(200); // as-built: addSubCategory responds 200 (not 201)

    const dup = await request(app)
      .post('/api/category/subcategory/add')
      .set('token', adminToken)
      .send({ categoryId: c._id.toString(), name: 'pro' }); // case-variant duplicate
    expect(dup.status).toBe(400);
    expect(dup.body.message).toMatch(/subcategory already exists/i);

    const doc = await categoryModel.findById(c._id).lean();
    expect(doc.subCategories).toHaveLength(1);
    expect(doc.subCategories[0]).toMatchObject({ name: 'Pro', sortOrder: 3 });
  });

  it('update: 400 missing, 404 unknown, applies the patch', async () => {
    const missing = await request(app)
      .put('/api/category/subcategory/update')
      .set('token', adminToken)
      .send({ name: 'only-name' }); // no categoryId/subCategoryName
    expect(missing.status).toBe(400);

    const { Types } = await import('mongoose');
    const ghost = await request(app)
      .put('/api/category/subcategory/update')
      .set('token', adminToken)
      .send({ categoryId: new Types.ObjectId().toString(), subCategoryName: 'X', newName: 'Y' });
    expect(ghost.status).toBe(404);

    const c = await makeCategory();
    await categoryModel.updateOne(
      { _id: c._id },
      { $push: { subCategories: { name: 'Old', description: '', isActive: true, sortOrder: 0 } } }
    );

    const res = await request(app)
      .put('/api/category/subcategory/update')
      .set('token', adminToken)
      .send({
        categoryId: c._id.toString(),
        subCategoryName: 'Old',
        newName: 'Renamed',
        isActive: false,
        sortOrder: 7,
      });
    expect(res.status).toBe(200);

    const doc = await categoryModel.findById(c._id).lean();
    expect(doc.subCategories[0]).toMatchObject({ name: 'Renamed', isActive: false, sortOrder: 7 });
  });

  it('remove: 400 missing, 404 unknown, deletes only the named subcategory', async () => {
    const missing = await request(app)
      .delete('/api/category/subcategory/remove')
      .set('token', adminToken)
      .send({});
    expect(missing.status).toBe(400);

    const { Types } = await import('mongoose');
    const ghost = await request(app)
      .delete('/api/category/subcategory/remove')
      .set('token', adminToken)
      .send({ categoryId: new Types.ObjectId().toString(), subCategoryName: 'X' });
    expect(ghost.status).toBe(404);

    const c = await makeCategory();
    await categoryModel.updateOne(
      { _id: c._id },
      {
        $push: {
          subCategories: [
            { name: 'Keep', description: '', isActive: true, sortOrder: 0 },
            { name: 'Drop', description: '', isActive: true, sortOrder: 1 },
          ],
        },
      }
    );

    const res = await request(app)
      .delete('/api/category/subcategory/remove')
      .set('token', adminToken)
      .send({ categoryId: c._id.toString(), subCategoryName: 'Drop' });
    expect(res.status).toBe(200);

    const doc = await categoryModel.findById(c._id).lean();
    expect(doc.subCategories.map((s) => s.name)).toEqual(['Keep']);
  });
});
