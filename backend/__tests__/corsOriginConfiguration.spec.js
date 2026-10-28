// Phase 4 regression — CORS origin configuration.
//
// Pins the reworked origin policy (config/allowedOrigins.js):
//   - local development origins are allowed only outside production
//   - production origins come from the ENVIRONMENT (FRONTEND_URL, ADMIN_URL,
//     CORS_EXTRA_ORIGINS) — the historical SKR Netlify domains are no longer
//     hardcoded
//   - trailing slashes are normalized; duplicates are removed
//   - unlisted origins are refused — and never via a wildcard: credentials
//     are enabled, so an origin echo must be an exact allowlist match
import { describe, it, expect } from '@jest/globals';
import request from 'supertest';

import app from '../app.js';
import { buildAllowedOrigins } from '../config/allowedOrigins.js';

describe('buildAllowedOrigins — environment-driven allowlist', () => {
  it('always includes the local development origins', () => {
    const origins = buildAllowedOrigins({});
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://localhost:5174');
  });

  it('does not include local development origins in production unless explicitly configured', () => {
    const origins = buildAllowedOrigins({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://shop.example.com',
      ADMIN_URL: 'https://admin.example.com',
    });

    expect(origins).toEqual(['https://shop.example.com', 'https://admin.example.com']);
    expect(origins).not.toContain('http://localhost:5173');
  });

  it('includes FRONTEND_URL and ADMIN_URL when set', () => {
    const origins = buildAllowedOrigins({
      FRONTEND_URL: 'https://shop.example.com',
      ADMIN_URL: 'https://admin.example.com',
    });
    expect(origins).toContain('https://shop.example.com');
    expect(origins).toContain('https://admin.example.com');
  });

  it('normalizes trailing slashes on environment origins', () => {
    const origins = buildAllowedOrigins({ FRONTEND_URL: 'https://shop.example.com/' });
    expect(origins).toContain('https://shop.example.com');
    expect(origins).not.toContain('https://shop.example.com/');
  });

  it('supports CORS_EXTRA_ORIGINS as a comma-separated list', () => {
    const origins = buildAllowedOrigins({
      CORS_EXTRA_ORIGINS: 'https://cdn.example.com, https://backup.example.com ,',
    });
    expect(origins).toContain('https://cdn.example.com');
    expect(origins).toContain('https://backup.example.com');
  });

  it('deduplicates repeated origins', () => {
    const origins = buildAllowedOrigins({
      FRONTEND_URL: 'http://localhost:5173',
      CORS_EXTRA_ORIGINS: 'http://localhost:5173',
    });
    expect(origins.filter((o) => o === 'http://localhost:5173')).toHaveLength(1);
  });

  it('does NOT hardcode the historical SKR Netlify domains', () => {
    const origins = buildAllowedOrigins({});
    expect(origins).not.toContain('https://skr-e-commerce.netlify.app');
    expect(origins).not.toContain('https://admin-skr-e-commerce.netlify.app');

    // ...but an operator can explicitly allow a Netlify origin via env.
    const withEnv = buildAllowedOrigins({ FRONTEND_URL: 'https://skr-e-commerce.netlify.app' });
    expect(withEnv).toContain('https://skr-e-commerce.netlify.app');
  });
});

describe('CORS HTTP behavior on the live app', () => {
  it('allows a request from a development origin with credentials', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects a request from an unlisted origin', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(500); // cors middleware raises -> error handler
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never answers with a wildcard allow-origin (credentials are enabled)', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});
