// Redis configuration for the Socket.IO multi-replica adapter.
//
// Design rules (match config/mongodb.js):
//   - Pure resolution from the environment; no IO, no client construction.
//   - Credentials NEVER appear in errors, logs, or summaries.
//   - Adapter is OPTIONAL: when no Redis target is configured the realtime
//     layer keeps the historical in-process adapter (single-replica safe).
//   - When Redis IS configured and the process is in production, the adapter
//     is REQUIRED: boot fails rather than silently claiming distributed
//     delivery while talking only to itself.
//
// Live readers (verified against services/socketService.js):
//   REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB, REDIS_TLS,
//   SOCKETIO_REDIS_REQUIRED, SOCKETIO_REDIS_CONNECT_TIMEOUT_MS,
//   SOCKETIO_REDIS_KEY, SOCKETIO_TRANSPORTS
//
// The legacy root-level `env.example` listed REDIS_URL/REDIS_PASSWORD/REDIS_DB
// for an analytics cache that never existed. Those names are reused here for
// the one feature that actually needs Redis: cross-pod Socket.IO fan-out.

const REDIS_SCHEME_RE = /^rediss?:\/\//i;
const VALID_TRANSPORTS = new Set(['websocket', 'polling']);

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_PORT = 6379;
const DEFAULT_DB = 0;
const DEFAULT_ADAPTER_KEY = 'socket.io';

/**
 * Credential-safe summary: protocol + host[:port][/db], never the password.
 */
export function summarizeRedisTarget(target) {
  if (!target || typeof target !== 'object') return 'none';
  const { host, port, db, tls } = target;
  if (!host) return 'none';
  const scheme = tls ? 'rediss' : 'redis';
  const portPart = port ? `:${port}` : '';
  const dbPart = Number.isInteger(db) && db > 0 ? `/${db}` : '';
  return `${scheme}://${host}${portPart}${dbPart}`;
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

function parseDb(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_DB;
  const db = Number(value);
  return Number.isInteger(db) && db >= 0 && db <= 15 ? db : DEFAULT_DB;
}

function parseTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_CONNECT_TIMEOUT_MS;
}

function isTrue(value) {
  return String(value).trim().toLowerCase() === 'true';
}

/**
 * Parse a redis:// or rediss:// URL into a credential-free target + password.
 * Returns null when the value is not a usable Redis URL.
 * Never includes the password in any thrown message.
 */
export function parseRedisUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();
  if (!url || !REDIS_SCHEME_RE.test(url)) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname;
  if (!host) return null;

  const tls = parsed.protocol.toLowerCase() === 'rediss:';
  const port = parsed.port ? parsePort(parsed.port) : DEFAULT_PORT;
  const pathDb = parsed.pathname.replace(/^\/+/, '').split('?')[0];
  const db = pathDb !== '' ? parseDb(pathDb) : DEFAULT_DB;
  const password = parsed.password || parsed.searchParams.get('password') || '';
  const username = parsed.username && parsed.username !== '' ? parsed.username : 'default';

  return {
    host,
    port,
    db,
    tls,
    password,
    username,
    summary: summarizeRedisTarget({ host, port, db, tls }),
  };
}

/**
 * Resolve Socket.IO transports from the environment.
 *
 * Default remains `['websocket', 'polling']` for single-node compatibility.
 * Multi-replica deployments that cannot guarantee session affinity for the
 * HTTP long-polling handshake should set SOCKETIO_TRANSPORTS=websocket
 * (WebSocket connections are long-lived and do not need sticky sessions).
 */
export function resolveSocketTransports(env = process.env) {
  const raw = typeof env.SOCKETIO_TRANSPORTS === 'string' ? env.SOCKETIO_TRANSPORTS : '';
  const requested = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => VALID_TRANSPORTS.has(item));

  if (requested.length === 0) return ['websocket', 'polling'];
  // Always try websocket first when both are allowed.
  if (requested.includes('websocket') && requested.includes('polling')) {
    return ['websocket', 'polling'];
  }
  return requested;
}

/**
 * Resolve the Redis adapter configuration. Pure.
 *
 * Returns one of:
 *   { enabled: false }
 *   { enabled: true, required, target, password, username, connectTimeoutMs,
 *     adapterKey, summary }
 *
 * `required` means: if Redis cannot be reached at boot, initialize() throws
 * (the process exits 1) instead of running with in-process delivery while
 * the deployment believes it has a Redis adapter.
 */
export function resolveRedisConfig(env = process.env) {
  const url = typeof env.REDIS_URL === 'string' ? env.REDIS_URL.trim() : '';
  const host = typeof env.REDIS_HOST === 'string' ? env.REDIS_HOST.trim() : '';
  const explicitPassword = typeof env.REDIS_PASSWORD === 'string' ? env.REDIS_PASSWORD : '';

  let target = null;
  let password = '';

  if (url) {
    target = parseRedisUrl(url);
    if (!target) {
      // Value was set but unusable — that is a configuration error, not a
      // reason to silently run without the adapter.
      return {
        enabled: true,
        invalid: true,
        required: isRequired(env),
        error:
          'REDIS_URL is set but is not a valid redis:// or rediss:// URL ' +
          '(the configured value was rejected without being logged)',
      };
    }
    password = target.password;
    // REDIS_PASSWORD fills the gap when the URL itself has no password.
    if (!password && explicitPassword) password = explicitPassword;
  } else if (host) {
    const port = parsePort(env.REDIS_PORT);
    const db = parseDb(env.REDIS_DB);
    const tls = isTrue(env.REDIS_TLS);
    target = {
      host,
      port,
      db,
      tls,
      summary: summarizeRedisTarget({ host, port, db, tls }),
    };
    password = explicitPassword;
  } else {
    return { enabled: false };
  }

  return {
    enabled: true,
    invalid: false,
    required: isRequired(env),
    target,
    password,
    username: target.username || 'default',
    connectTimeoutMs: parseTimeout(env.SOCKETIO_REDIS_CONNECT_TIMEOUT_MS),
    adapterKey:
      typeof env.SOCKETIO_REDIS_KEY === 'string' && env.SOCKETIO_REDIS_KEY.trim() !== ''
        ? env.SOCKETIO_REDIS_KEY.trim()
        : DEFAULT_ADAPTER_KEY,
    summary: target.summary,
  };
}

function isRequired(env) {
  const explicit = typeof env.SOCKETIO_REDIS_REQUIRED === 'string' ? env.SOCKETIO_REDIS_REQUIRED.trim() : '';
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  // Default: production + a configured Redis target must actually work.
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * ioredis client options. Two clients (pub + sub) are built from these
 * options; `duplicate()` on the pub client produces the sub client so the
 * pair always shares connection settings.
 */
export function buildRedisClientOptions(config) {
  if (!config || !config.enabled || config.invalid || !config.target) return null;

  const { target, password, username, connectTimeoutMs } = config;

  return {
    host: target.host,
    port: target.port,
    db: target.db,
    tls: target.tls ? {} : undefined,
    username: username || undefined,
    password: password || undefined,
    lazyConnect: true,
    connectTimeout: connectTimeoutMs,
    // The adapter publishes on every broadcast. During a brief Redis drop we
    // want ioredis to retry the connection (retryStrategy below) rather than
    // reject every publish and crash a money path. Status is what health
    // reports — a queued publish during a partition is better than a 500.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
    // Never print the password in ioredis's own debug/error strings.
    showFriendlyErrorStack: false,
  };
}
