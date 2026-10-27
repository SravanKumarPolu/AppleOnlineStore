#!/usr/bin/env node
// Read-only database audit (migration + integrity + safety).
//
// Replaces the previous debug script, which printed a FULL sample order
// document — shipping address, email, items — to stdout. A copied/migrated
// database contains real customer data, so no document contents are printed
// here: only database/collection names, counts, index metadata and booleans.
//
// What it verifies
//   1. the effective database selected by MONGODB_URI (a URI path wins; only a
//      bare host falls back to MONGODB_DB / the historical "e-commerce"),
//   2. every expected collection exists,
//   3. document counts against the migration snapshot (drift is a warning
//      unless --strict),
//   4. the invariants the app relies on: unique idempotency index, no duplicate
//      (userId, idempotencyKey) pairs, no order pointing at a missing user or
//      product,
//   5. whether a boot-time inventory sweep would mutate anything (expired
//      holds / uncommitted drafts / owed restorations) — useful before running
//      the app against migrated data.
//
// Usage
//   node scripts/checkDatabase.js                 # snapshot defaults below
//   node scripts/checkDatabase.js --strict        # count drift also fails
//   node scripts/checkDatabase.js --expect '{"orders":91,"products":24}'
//
// Exit codes: 0 = structure + invariants OK, 1 = defect found, 2 = could not run.
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { resolveMongoConnectionUri } from '../config/mongodb.js';
import { redactError, summarizeMongoUri } from '../utils/redact.js';

dotenv.config();

// Snapshot from the logical backup that seeded the migrated database
// (docs/dev10 / migration brief). Counts drift as soon as the app runs; use
// --strict only when comparing immediately after a restore.
const EXPECTED_SNAPSHOT = {
  orders: 91,
  products: 24,
  useractivities: 10,
  categories: 6,
  users: 4,
  addresses: 3,
  productperformances: 3,
  webhookevents: 0,
  searchanalytics: 0,
  transfers: 0,
  salesanalytics: 0,
  sessions: 0,
};

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const expectIndex = argv.indexOf('--expect');
let expected = EXPECTED_SNAPSHOT;
if (expectIndex !== -1 && argv[expectIndex + 1]) {
  try {
    expected = JSON.parse(argv[expectIndex + 1]);
  } catch {
    console.error('❌ --expect must be a JSON object like {"orders":91}');
    process.exit(2);
  }
}

const failures = [];
const warnings = [];

const checkDatabase = async () => {
  let connection;
  try {
    const { uri, database } = resolveMongoConnectionUri(process.env);
    // summarizeMongoUri masks credentials; the raw URI is never printed.
    console.log(`🔌 Connecting to ${summarizeMongoUri(uri)} (database: ${database})`);
    connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 12000 }).asPromise();
    const db = connection.db;

    const effective = db.databaseName;
    console.log(`✅ Connected — effective database: ${effective}`);
    if (effective !== database) {
      failures.push(`effective database "${effective}" does not match the configured "${database}"`);
    }

    const collections = (await db.listCollections().toArray())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    console.log(`\n📚 Collections (${collections.length}):`);
    const counts = new Map();
    let total = 0;
    for (const name of collections) {
      const count = await db.collection(name).countDocuments();
      counts.set(name, count);
      total += count;
      const want = expected[name];
      const marker = want === undefined ? '' : count === want ? ' ✅' : ` ⚠️ snapshot ${want}`;
      console.log(`  - ${name}: ${count}${marker}`);
    }

    const missing = Object.keys(expected).filter((name) => !collections.includes(name));
    const unexpected = collections.filter((name) => !(name in expected));
    if (missing.length) failures.push(`missing collections: ${missing.join(', ')}`);
    if (unexpected.length) warnings.push(`collections outside the snapshot: ${unexpected.join(', ')}`);

    for (const [name, want] of Object.entries(expected)) {
      if (!collections.includes(name)) continue;
      const count = counts.get(name);
      if (count !== want) warnings.push(`count drift: ${name} ${count} (snapshot ${want})`);
    }
    console.log(`\nΣ documents in the expected collections: ${total}`);

    // Index inventory for the collections whose invariants matter.
    console.log('\n🗂️  Indexes:');
    for (const name of ['orders', 'users', 'products']) {
      if (!collections.includes(name)) continue;
      const indexes = await db.collection(name).indexes();
      const described = indexes.map(
        (idx) =>
          `${Object.keys(idx.key).join('+')}${idx.unique ? ' UNIQUE' : ''}${
            idx.partialFilterExpression ? ' PARTIAL' : ''
          }${idx.sparse ? ' SPARSE' : ''}`
      );
      console.log(`  - ${name} (${indexes.length}): ${described.join(' | ')}`);
    }

    const orderIndexes = collections.includes('orders')
      ? await db.collection('orders').indexes()
      : [];
    const idempotencyIndex = orderIndexes.find(
      (idx) => idx.key?.userId === 1 && idx.key?.idempotencyKey === 1 && idx.unique
    );
    if (collections.includes('orders')) {
      if (idempotencyIndex) console.log('✅ unique (userId, idempotencyKey) index present');
      else failures.push('unique (userId, idempotencyKey) index is MISSING — duplicate checkouts are possible');
    }

    // Invariants — counts only, never document contents.
    if (collections.includes('orders')) {
      const duplicateGroups = await db
        .collection('orders')
        .aggregate([
          { $match: { idempotencyKey: { $type: 'string' } } },
          { $group: { _id: { u: '$userId', k: '$idempotencyKey' }, n: { $sum: 1 } } },
          { $match: { n: { $gt: 1 } } },
          { $count: 'groups' },
        ])
        .toArray();
      const duplicates = duplicateGroups[0]?.groups ?? 0;
      console.log(`duplicate (userId, idempotencyKey) groups: ${duplicates}`);
      if (duplicates > 0) failures.push(`${duplicates} duplicate idempotency key group(s)`);

      const userIds = new Set(
        (await db.collection('users').find({}, { projection: { _id: 1 } }).toArray()).map((u) =>
          String(u._id)
        )
      );
      const productIds = new Set(
        (await db.collection('products').find({}, { projection: { _id: 1 } }).toArray()).map((p) =>
          String(p._id)
        )
      );
      const orders = await db
        .collection('orders')
        .find({}, { projection: { userId: 1, 'items.productId': 1 } })
        .toArray();

      let orphanOwners = 0;
      let orphanLines = 0;
      let ownerless = 0;
      for (const order of orders) {
        if (!order.userId) ownerless += 1;
        else if (!userIds.has(String(order.userId))) orphanOwners += 1;
        for (const item of order.items || []) {
          if (item?.productId && !productIds.has(String(item.productId))) orphanLines += 1;
        }
      }
      console.log(
        `referential integrity: orders→users orphans ${orphanOwners} · order lines→products orphans ${orphanLines} · ownerless orders ${ownerless}`
      );
      if (orphanOwners > 0) failures.push(`${orphanOwners} order(s) reference a missing user`);
      if (ownerless > 0) warnings.push(`${ownerless} order(s) have no userId (legacy/anonymous)`);
      if (orphanLines > 0) warnings.push(`${orphanLines} order line(s) reference a missing product (snapshot data)`);

      // Would a boot-time sweep mutate migrated data?
      const now = new Date();
      const expiredHolds = await db.collection('orders').countDocuments({
        stockReserved: true,
        paymentStatus: 'pending',
        paymentMethod: 'PayPal',
        reservationExpiresAt: { $ne: null, $lte: now },
      });
      const drafts = await db.collection('orders').countDocuments({
        stockReserved: false,
        'stockReservation.status': { $in: ['pending', 'releasing', 'failed'] },
      });
      const owed = await db.collection('orders').countDocuments({
        'inventoryRestoration.status': { $in: ['pending', 'reconciliation_required'] },
      });
      console.log(
        `boot-sweep impact: expired holds ${expiredHolds} · uncommitted drafts ${drafts} · owed restorations ${owed}`
      );
      if (expiredHolds || drafts || owed) {
        warnings.push(
          'starting the app would run the inventory sweep and may modify these orders (review before booting)'
        );
      }
    }

    if (strict && warnings.length) {
      for (const warning of warnings) failures.push(`strict: ${warning}`);
    }

    console.log('');
    for (const warning of warnings) console.log(`⚠️  ${warning}`);
    if (failures.length) {
      for (const failure of failures) console.error(`❌ ${failure}`);
      console.error(`\n❌ DATABASE AUDIT FAILED (${failures.length} issue(s))`);
      process.exitCode = 1;
    } else {
      console.log('✅ DATABASE AUDIT PASSED — structure, indexes and references are consistent');
      process.exitCode = 0;
    }
  } catch (error) {
    // redactError strips connection strings / credentials from driver messages.
    console.error('❌ Database audit could not run:', redactError(error));
    console.error(
      '   If this is an Atlas cluster, check the project IP access list and that the cluster is running.'
    );
    process.exitCode = 2;
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
};

await checkDatabase();
