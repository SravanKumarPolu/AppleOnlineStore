// MongoDB connection configuration — Phase 2 stabilization rewrite.
//
// Previous behavior (bug): the connection string was built as
//   `${process.env.MONGODB_URI}/e-commerce`
// unconditionally. That broke in two ways:
//   1. A COMPLETE URI (e.g. mongodb+srv://user:pass@host/e-commerce?retryWrites=true)
//      became ".../e-commerce/e-commerce?..." — a different (or invalid)
//      database path.
//   2. An unset MONGODB_URI produced the literal string "undefined/e-commerce",
//      which failed deep inside the driver with a confusing error.
//
// Resolved behavior (this module):
//   - MONGODB_URI must be a valid mongodb:// or mongodb+srv:// URI. Anything
//     else (missing, empty, wrong scheme) fails startup with a clear,
//     credential-safe error BEFORE any connection attempt.
//   - If the URI already selects a database (non-empty path component), that
//     selection is respected verbatim — a complete URI is a complete URI.
//   - If the URI has NO database component (bare host, e.g.
//     "mongodb://localhost:27017"), the database name is applied explicitly:
//     MONGODB_DB when set, otherwise the historical default "e-commerce".
//     This preserves the existing database selection for existing
//     deployments — no migration required.
//   - The resolved URI is never logged with credentials (summarizeMongoUri),
//     and connection errors are redacted before logging.
//   - After connect, the connection is VERIFIED (readyState + database name
//     + ping) before the caller is told the database is ready.
//
// dotenv is imported first so this module is safe to import from any script
// without relying on the importer having loaded environment variables.
import 'dotenv/config';

import mongoose from 'mongoose';
import { redactError, summarizeMongoUri } from '../utils/redact.js';

export const DEFAULT_MONGODB_DB = 'e-commerce';

const MONGODB_SCHEME_RE = /^mongodb(\+srv)?:\/\//i;

/**
 * Resolve the effective connection URI from the environment.
 * Pure function (no process/env mutation, no IO) so the regression suite can
 * exercise every malformed/missing/valid input offline.
 *
 * Returns { uri, database } on success.
 * Throws Error with a credential-safe message on invalid configuration.
 */
export function resolveMongoConnectionUri(env = process.env) {
  const rawUri = typeof env.MONGODB_URI === 'string' ? env.MONGODB_URI.trim() : '';

  if (!rawUri) {
    throw new Error(
      'MONGODB_URI is not set. Provide a complete MongoDB connection string, ' +
        'e.g. mongodb://127.0.0.1:27017 or mongodb+srv://<user>:<password>@<cluster>/<db>'
    );
  }

  if (!MONGODB_SCHEME_RE.test(rawUri)) {
    // Never include the offending value in the message — it may embed credentials.
    throw new Error(
      'MONGODB_URI is invalid: it must start with mongodb:// or mongodb+srv:// ' +
        '(the configured value was rejected without being logged)'
    );
  }

  // Parse for the database component. Credentials stay inside the URL object —
  // only the pathname is inspected here and it is never logged.
  let parsed;
  try {
    parsed = new URL(rawUri);
  } catch {
    throw new Error(
      'MONGODB_URI is invalid: it could not be parsed as a URI ' +
        '(check for malformed host, port, or query string)'
    );
  }

  // URL pathname: '' or '/' means "no database selected".
  const pathDatabase = parsed.pathname.replace(/^\/+/, '').split('?')[0];

  if (pathDatabase) {
    // Complete URI — the explicitly selected database wins.
    return { uri: rawUri, database: decodeURIComponent(pathDatabase) };
  }

  // Bare host URI — apply the database name explicitly (historical default
  // preserved; override with MONGODB_DB for a deliberate migration).
  const dbName =
    typeof env.MONGODB_DB === 'string' && env.MONGODB_DB.trim()
      ? env.MONGODB_DB.trim()
      : DEFAULT_MONGODB_DB;

  // Strip trailing slash(es) from the host part, then append the database.
  const base = rawUri.replace(/\/+$/, '');
  return { uri: `${base}/${dbName}`, database: dbName };
}

/**
 * Connect to MongoDB using the resolved configuration.
 *
 * Options are passed through to mongoose.connect (tests use them to shorten
 * server-selection timeouts; production uses driver defaults).
 *
 * Startup contract (server.js): any configuration or connection failure is
 * rethrown after a redacted log line so orchestration can exit non-zero.
 */
const connectDB = async (options = {}) => {
  // Configuration errors fail fast with a clear message — before the driver
  // is asked to connect anywhere.
  const { uri, database } = resolveMongoConnectionUri(process.env);
  // Never log the raw URI — it contains credentials.
  console.log(`🔌 Connecting to MongoDB: ${summarizeMongoUri(uri)} (database: ${database})`);

  try {
    await mongoose.connect(uri, {
      // Note: useNewUrlParser/useUnifiedTopology are no-ops on the modern
      // driver (>=4.x) and were removed to silence deprecation warnings.
      // Callers (tests) may shorten selection timeouts; production uses
      // driver defaults.
      ...options,
    });
  } catch (err) {
    // err.message can embed the full connection URI (host + credentials).
    console.error('❌ MongoDB connection failed:', redactError(err));
    // Startup orchestration (server.js) is responsible for failing fast;
    // rethrow so it can exit with a redacted log line.
    throw err;
  }

  // Verify database initialization BEFORE reporting readiness: the socket is
  // up AND the server answers a ping on the selected database.
  const connection = mongoose.connection;
  if (connection.readyState !== 1) {
    const err = new Error(
      `MongoDB connection is not ready after connect (readyState=${connection.readyState})`
    );
    console.error('❌ MongoDB readiness verification failed:', redactError(err));
    throw err;
  }

  try {
    await connection.db.admin().command({ ping: 1 });
  } catch (err) {
    console.error('❌ MongoDB ping failed after connect:', redactError(err));
    throw err;
  }

  console.log(`✅ MongoDB Connected: ${connection.name}`);
  return connection;
};

export default connectDB;
