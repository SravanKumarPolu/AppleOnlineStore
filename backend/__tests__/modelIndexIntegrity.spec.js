// Regression lock for the index/startup contract fixed in this audit.
//
// Two defects are covered here:
//   1. `categories.name` and `users.email` were each declared TWICE (field-level
//      `unique: true` plus a plain `schema.index({field: 1})`). The two
//      declarations produced the same auto-generated index name with different
//      uniqueness, so `Model.init()` failed — invisible while indexes were built
//      in the background, fatal once startup started awaiting them.
//   2. Mongoose builds indexes asynchronously after `connect()`. On a fresh
//      database that left a window where the {userId, idempotencyKey} unique
//      partial index did not exist yet, and five concurrent checkouts carrying
//      one Idempotency-Key produced five orders (checkoutIdempotency suite).
//      `connectDB()` now awaits `Model.init()` before the server listens.
//
// If either regresses, this suite fails before the money-path specs do.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import mongoose from 'mongoose';

import connectDB from '../config/mongodb.js';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import categoryModel from '../models/categoryModel.js';
import webhookEventModel from '../models/webhookEventModel.js';
// Imported for their side effects: every model must be compiled before the
// index-integrity assertions below.
import '../models/productModel.js';
import '../models/analyticsModel.js';
import '../models/addressModel.js';
import { startTestDb, stopTestDb } from './helpers.mjs';

let db;

beforeAll(async () => {
  db = await startTestDb();
});

afterAll(async () => {
  await stopTestDb(db);
});

describe('model index integrity', () => {
  it('initializes every model without an index-name conflict', async () => {
    const models = Object.values(mongoose.models);
    expect(models.length).toBeGreaterThanOrEqual(7);

    // Fails with "An existing index has the same name as the requested index"
    // when a field is declared twice with different options.
    await expect(Promise.all(models.map((model) => model.init()))).resolves.toBeDefined();
  });

  it('keeps the AF-1 idempotency backstop unique and partial', async () => {
    const indexes = await orderModel.collection.indexes();
    const idempotencyIndex = indexes.find(
      (index) => index.key.userId === 1 && index.key.idempotencyKey === 1
    );

    expect(idempotencyIndex).toBeDefined();
    expect(idempotencyIndex.unique).toBe(true);
    // Partial: orders without a key (legacy documents, PayPal orders) are
    // exempt from uniqueness, so they must never collide.
    expect(idempotencyIndex.partialFilterExpression).toEqual({
      idempotencyKey: { $type: 'string' },
    });
  });

  it('declares exactly one unique index per identity field', async () => {
    const identityFields = [
      [userModel, 'email'],
      [categoryModel, 'name'],
      [webhookEventModel, 'eventId'],
    ];

    for (const [model, field] of identityFields) {
      const indexes = await model.collection.indexes();
      const singleFieldIndexes = indexes.filter(
        (index) => Object.keys(index.key).length === 1 && index.key[field] === 1
      );

      // One and only one: a duplicate declaration here is what broke init().
      expect(singleFieldIndexes).toHaveLength(1);
      expect(singleFieldIndexes[0].unique).toBe(true);
    }
  });

  // Runs last: it drops the mongoose connection and reconnects through the
  // production entry point.
  it('connectDB resolves only after the declared indexes exist', async () => {
    await mongoose.disconnect();

    const previousUri = process.env.MONGODB_URI;
    process.env.MONGODB_URI = db.mongod.getUri('index-contract-test');

    try {
      await connectDB();

      // No sleep, no polling: connectDB() promises that indexes are ready by
      // the time it resolves (server.js listens only afterwards).
      const indexes = await orderModel.collection.indexes();
      const idempotencyIndex = indexes.find(
        (index) => index.key.userId === 1 && index.key.idempotencyKey === 1
      );
      expect(idempotencyIndex?.unique).toBe(true);

      const userIndexes = await userModel.collection.indexes();
      expect(userIndexes.some((index) => index.key.email === 1 && index.unique)).toBe(true);
    } finally {
      if (previousUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = previousUri;
    }
  });
});
