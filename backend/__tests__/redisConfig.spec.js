// Unit tests for config/redis.js — pure resolution, no IO.
//
// These lock the deployment contract:
//   - no Redis configured  -> adapter OFF (single-replica behavior preserved)
//   - Redis configured     -> credentials parsed, never echoed
//   - production default   -> adapter REQUIRED (fail closed, never pretend)
//   - transports default   -> websocket + polling (compatibility), overridable
import { describe, it, expect } from '@jest/globals';

import {
  buildRedisClientOptions,
  parseRedisUrl,
  resolveRedisConfig,
  resolveSocketTransports,
  summarizeRedisTarget,
} from '../config/redis.js';
import { redactError, summarizeRedisUri } from '../utils/redact.js';

describe('resolveRedisConfig', () => {
  it('is disabled when neither REDIS_URL nor REDIS_HOST is set', () => {
    const config = resolveRedisConfig({ NODE_ENV: 'production' });
    expect(config).toEqual({ enabled: false });
  });

  it('parses REDIS_URL including credentials without exposing them', () => {
    const config = resolveRedisConfig({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://app:s3cr3t-pass@redis.internal:6380/2',
    });

    expect(config.enabled).toBe(true);
    expect(config.invalid).toBe(false);
    expect(config.required).toBe(true);
    expect(config.target).toMatchObject({ host: 'redis.internal', port: 6380, db: 2, tls: false });
    expect(config.password).toBe('s3cr3t-pass');
    expect(config.username).toBe('app');
    expect(config.summary).toBe('redis://redis.internal:6380/2');
    expect(JSON.stringify(config.summary)).not.toContain('s3cr3t-pass');
  });

  it('treats rediss:// as TLS', () => {
    const config = resolveRedisConfig({ REDIS_URL: 'rediss://redis.example.com:6379' });
    expect(config.target.tls).toBe(true);
    expect(config.summary).toBe('rediss://redis.example.com:6379');
  });

  it('builds from discrete REDIS_HOST parts and applies REDIS_PASSWORD', () => {
    const config = resolveRedisConfig({
      REDIS_HOST: 'redis',
      REDIS_PORT: '6380',
      REDIS_DB: '3',
      REDIS_TLS: 'true',
      REDIS_PASSWORD: 'from-env',
      NODE_ENV: 'test',
    });
    expect(config.target).toMatchObject({ host: 'redis', port: 6380, db: 3, tls: true });
    expect(config.password).toBe('from-env');
    expect(config.required).toBe(false);
    expect(config.summary).toBe('rediss://redis:6380/3');
  });

  it('prefers REDIS_URL over discrete parts', () => {
    const config = resolveRedisConfig({
      REDIS_URL: 'redis://from-url:6379',
      REDIS_HOST: 'ignored',
    });
    expect(config.target.host).toBe('from-url');
  });

  it('marks an unusable REDIS_URL invalid instead of silently disabling', () => {
    const config = resolveRedisConfig({ REDIS_URL: 'http://not-redis:6379' });
    expect(config.enabled).toBe(true);
    expect(config.invalid).toBe(true);
    expect(config.error).toMatch(/REDIS_URL is set but is not a valid/);
    expect(config.error).not.toContain('not-redis');
  });

  it('defaults required=true only in production', () => {
    const base = { REDIS_URL: 'redis://redis:6379' };
    expect(resolveRedisConfig({ ...base, NODE_ENV: 'production' }).required).toBe(true);
    expect(resolveRedisConfig({ ...base, NODE_ENV: 'staging' }).required).toBe(false);
    expect(resolveRedisConfig({ ...base, NODE_ENV: 'test' }).required).toBe(false);
  });

  it('honors an explicit SOCKETIO_REDIS_REQUIRED override in both directions', () => {
    expect(
      resolveRedisConfig({
        REDIS_URL: 'redis://redis:6379',
        NODE_ENV: 'production',
        SOCKETIO_REDIS_REQUIRED: 'false',
      }).required
    ).toBe(false);
    expect(
      resolveRedisConfig({
        REDIS_URL: 'redis://redis:6379',
        NODE_ENV: 'test',
        SOCKETIO_REDIS_REQUIRED: 'true',
      }).required
    ).toBe(true);
  });

  it('applies the adapter key and a positive connect timeout with defaults', () => {
    const config = resolveRedisConfig({
      REDIS_URL: 'redis://redis:6379',
      SOCKETIO_REDIS_KEY: 'novacart:bus',
      SOCKETIO_REDIS_CONNECT_TIMEOUT_MS: '2500',
    });
    expect(config.adapterKey).toBe('novacart:bus');
    expect(config.connectTimeoutMs).toBe(2500);

    const defaults = resolveRedisConfig({ REDIS_URL: 'redis://redis:6379' });
    expect(defaults.adapterKey).toBe('socket.io');
    expect(defaults.connectTimeoutMs).toBe(10_000);
  });
});

describe('parseRedisUrl', () => {
  it('rejects non-redis schemes and malformed values', () => {
    expect(parseRedisUrl('http://localhost:6379')).toBeNull();
    expect(parseRedisUrl('not a url')).toBeNull();
    expect(parseRedisUrl('')).toBeNull();
    expect(parseRedisUrl(undefined)).toBeNull();
  });

  it('defaults port 6379 and db 0', () => {
    const parsed = parseRedisUrl('redis://localhost');
    expect(parsed).toMatchObject({ host: 'localhost', port: 6379, db: 0 });
  });

  it('accepts a password supplied as a query parameter', () => {
    const parsed = parseRedisUrl('redis://cache:6390?password=query-pass');
    expect(parsed.password).toBe('query-pass');
    expect(parsed.summary).not.toContain('query-pass');
  });
});

describe('summarizeRedisTarget / summarizeRedisUri', () => {
  it('never includes credentials', () => {
    expect(summarizeRedisTarget({ host: 'h', port: 6379, db: 0, tls: false })).toBe('redis://h:6379');
    expect(summarizeRedisUri('redis://user:secret@h:6379/1')).toBe('redis://h:6379/1');
    expect(summarizeRedisUri('rediss://user:secret@h:6380')).toBe('rediss://h:6380');
  });
});

describe('redactError with Redis credentials', () => {
  it('removes redis:// and rediss:// passwords from messages', () => {
    expect(redactError(new Error('connect failed redis://u:topsecret@h:6379'))).not.toContain(
      'topsecret'
    );
    expect(redactError('rediss://u:another-secret@h:6380')).toBe('rediss://***:***@h:6380');
  });
});

describe('buildRedisClientOptions', () => {
  it('returns null when the adapter is disabled or invalid', () => {
    expect(buildRedisClientOptions({ enabled: false })).toBeNull();
    expect(buildRedisClientOptions({ enabled: true, invalid: true })).toBeNull();
  });

  it('builds lazy, retrying ioredis options from the resolved config', () => {
    const config = resolveRedisConfig({
      REDIS_URL: 'rediss://app:pw@redis.internal:6380/2',
      SOCKETIO_REDIS_CONNECT_TIMEOUT_MS: '1234',
    });
    const options = buildRedisClientOptions(config);

    expect(options).toMatchObject({
      host: 'redis.internal',
      port: 6380,
      db: 2,
      username: 'app',
      password: 'pw',
      lazyConnect: true,
      connectTimeout: 1234,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });
    expect(options.tls).toEqual({});
    expect(typeof options.retryStrategy).toBe('function');
    expect(options.retryStrategy(1)).toBe(200);
    expect(options.retryStrategy(1000)).toBe(5000);
  });
});

describe('resolveSocketTransports', () => {
  it('defaults to websocket + polling for compatibility', () => {
    expect(resolveSocketTransports({})).toEqual(['websocket', 'polling']);
    expect(resolveSocketTransports({ SOCKETIO_TRANSPORTS: 'bogus' })).toEqual([
      'websocket',
      'polling',
    ]);
  });

  it('supports websocket-only for multi-replica without session affinity', () => {
    expect(resolveSocketTransports({ SOCKETIO_TRANSPORTS: 'websocket' })).toEqual(['websocket']);
  });

  it('normalizes case/whitespace and keeps websocket first', () => {
    expect(resolveSocketTransports({ SOCKETIO_TRANSPORTS: ' Polling , WebSocket ' })).toEqual([
      'websocket',
      'polling',
    ]);
  });
});
