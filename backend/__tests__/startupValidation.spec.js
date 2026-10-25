// Startup credential guardrails + unified PayPal environment selection —
// pre-production readiness (credential rotation + sandbox validation).
//
// These specs are pure/offline: validateRuntimeConfig() and
// config/paypalEnv.js never touch the network or the database, so the whole
// escalation matrix (fatal vs warning) is driven with literal env objects.
import { describe, it, expect } from '@jest/globals';

import {
  isLivePayPal,
  getPayPalEnvironmentName,
  createPayPalEnvironment,
} from '../config/paypalEnv.js';
import {
  validateRuntimeConfig,
  formatStartupConfigReport,
  isPlaceholder,
} from '../config/startupValidation.js';

// ---------------------------------------------------------------------------
// config/paypalEnv.js — the single environment switch
// ---------------------------------------------------------------------------
describe('config/paypalEnv — single source of truth for the PayPal environment', () => {
  it('treats PAYPAL_ENV=live (case-insensitive, trimmed) as live, everything else as sandbox', () => {
    expect(isLivePayPal('live')).toBe(true);
    expect(isLivePayPal(' LIVE ')).toBe(true);
    expect(isLivePayPal('Live')).toBe(true);
    expect(isLivePayPal('sandbox')).toBe(false);
    expect(isLivePayPal(undefined)).toBe(false); // unset can never mean live
    expect(isLivePayPal('')).toBe(false);
    expect(isLivePayPal('production')).toBe(false); // NODE_ENV values are NOT PayPal env values
    expect(getPayPalEnvironmentName('live')).toBe('live');
    expect(getPayPalEnvironmentName(undefined)).toBe('sandbox');
  });

  it('builds a LiveEnvironment only for live, SandboxEnvironment otherwise', () => {
    expect(createPayPalEnvironment('id', 'secret', 'live').constructor.name).toBe('LiveEnvironment');
    expect(createPayPalEnvironment('id', 'secret', 'sandbox').constructor.name).toBe(
      'SandboxEnvironment'
    );
    expect(createPayPalEnvironment('id', 'secret', undefined).constructor.name).toBe(
      'SandboxEnvironment'
    );
  });
});

// ---------------------------------------------------------------------------
// config/startupValidation.js — escalation matrix
// ---------------------------------------------------------------------------
const HEALTHY_ENV = {
  NODE_ENV: 'production',
  PAYPAL_ENV: 'live',
  PAYPAL_CLIENT_ID: 'AeA1QIZXkHmQRealClientIdNotAPlaceholder',
  PAYPAL_CLIENT_SECRET: 'EGrJLaRealClientSecretNotAPlaceholder',
  PAYPAL_WEBHOOK_ID: '4XY123RealWebhookIdNotAPlaceholder',
  JWT_SECRET: 'a-real-64-character-secret-that-is-definitely-not-a-template-value-1234567890',
  ADMIN_EMAIL: 'owner@novacart.example',
  ADMIN_PASSWORD: 'a-real-admin-password',
};

function withOverrides(overrides) {
  return { ...HEALTHY_ENV, ...overrides };
}

describe('config/startupValidation — escalation matrix', () => {
  it('accepts a fully-credentialed live production configuration', () => {
    const report = validateRuntimeConfig({ env: HEALTHY_ENV });
    expect(report.fatal).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.paypalEnvironment).toBe('live');
  });

  it('FATAL: a sandbox/example payee with live credentials would misroute real money', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_PAYEE_EMAIL: 'sb-business@business.example.com' }),
    });
    expect(report.fatal.join(' ')).toMatch(/PAYPAL_PAYEE_EMAIL/);
  });

  it('accepts a real payee address in live', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_PAYEE_EMAIL: 'payments@novacart.com' }),
    });
    expect(report.fatal).toEqual([]);
  });

  it('flags a malformed payee as a warning in sandbox (fatal in live)', () => {
    const sandbox = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_ENV: 'sandbox', NODE_ENV: 'development', PAYPAL_PAYEE_EMAIL: 'not-an-email' }),
    });
    expect(sandbox.fatal).toEqual([]);
    expect(sandbox.warnings.join(' ')).toMatch(/PAYPAL_PAYEE_EMAIL is not a valid email/);

    const live = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_PAYEE_EMAIL: 'not-an-email' }),
    });
    expect(live.fatal.join(' ')).toMatch(/PAYPAL_PAYEE_EMAIL/);
  });

  it('FATAL: PAYPAL_ENV=live with missing PayPal credentials refuses to boot', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_CLIENT_SECRET: undefined }),
    });
    expect(report.fatal).toHaveLength(1);
    expect(report.fatal[0]).toContain('PAYPAL_CLIENT_SECRET');
  });

  it('FATAL: PAYPAL_ENV=live with .env.example placeholder credentials refuses to boot', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({
        PAYPAL_CLIENT_ID: 'your-paypal-client-id',
        PAYPAL_WEBHOOK_ID: 'your-paypal-webhook-id',
      }),
    });
    expect(report.fatal).toHaveLength(2);
    expect(report.fatal.join(' ')).toContain('PAYPAL_CLIENT_ID');
    expect(report.fatal.join(' ')).toContain('PAYPAL_WEBHOOK_ID');
  });

  it('FATAL: NODE_ENV=production with a missing/placeholder JWT_SECRET refuses to boot', () => {
    const missing = validateRuntimeConfig({
      env: withOverrides({ JWT_SECRET: undefined }),
    });
    expect(missing.fatal.some((f) => f.includes('JWT_SECRET'))).toBe(true);

    const placeholder = validateRuntimeConfig({
      env: withOverrides({ JWT_SECRET: 'your-super-secret-jwt-key-here' }),
    });
    expect(placeholder.fatal.some((f) => f.includes('JWT_SECRET'))).toBe(true);
  });

  it('WARNING (not fatal): a sandbox staging build may run with partial PayPal credentials', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({
        NODE_ENV: 'development',
        PAYPAL_ENV: 'sandbox',
        PAYPAL_CLIENT_ID: undefined,
        PAYPAL_WEBHOOK_ID: undefined,
      }),
    });
    expect(report.fatal).toEqual([]);
    expect(report.warnings.some((w) => w.includes('PAYPAL_CLIENT_ID'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('PAYPAL_WEBHOOK_ID'))).toBe(true);
  });

  it('WARNING: NODE_ENV=production without PAYPAL_ENV=live is surfaced as an explicit choice', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_ENV: 'sandbox' }),
    });
    expect(report.fatal).toEqual([]);
    expect(
      report.warnings.some((w) => w.includes('NODE_ENV=production') && w.includes('SANDBOX'))
    ).toBe(true);
  });

  it('WARNING: live credentials in a non-production build are surfaced for review', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({ NODE_ENV: 'development' }),
    });
    expect(report.fatal).toEqual([]);
    expect(
      report.warnings.some((w) => w.includes('LIVE credentials in a non-production build'))
    ).toBe(true);
  });

  it('flags placeholder admin credentials as warnings without blocking sandbox boots', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({
        NODE_ENV: 'test',
        PAYPAL_ENV: 'sandbox',
        ADMIN_PASSWORD: 'your-admin-password',
      }),
    });
    expect(report.fatal).toEqual([]);
    expect(report.warnings.some((w) => w.includes('ADMIN_PASSWORD'))).toBe(true);
  });

  it('isPlaceholder recognizes template values but not real credentials', () => {
    expect(isPlaceholder('your-paypal-client-id')).toBe(true);
    expect(isPlaceholder('your-anything')).toBe(true);
    expect(isPlaceholder('CHANGE_ME_now')).toBe(true);
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
    expect(isPlaceholder('AeA1QIZXkHmRealClientId')).toBe(false);
    expect(isPlaceholder('test-client-id')).toBe(false); // regression-suite values are fine
  });

  it('formatStartupConfigReport names variables but never exposes values', () => {
    const report = validateRuntimeConfig({
      env: withOverrides({ PAYPAL_WEBHOOK_ID: 'SECRETVALUE' }),
    });
    const text = formatStartupConfigReport(report).join('\n');
    expect(text).toContain('PayPal environment: LIVE');
    expect(text).not.toContain('SECRETVALUE');
  });
});

// ---------------------------------------------------------------------------
// Guardrail wiring — server.js must consult the validator before listening.
// (Import server.js and assert the validation module is part of its startup
// imports; the fatal path itself is covered by the unit matrix above.)
// ---------------------------------------------------------------------------
describe('server startup wiring', () => {
  it('startServer module integrates the credential guardrails', async () => {
    const serverSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../server.js', import.meta.url), 'utf-8')
    );
    expect(serverSource).toContain('validateRuntimeConfig()');
    expect(serverSource).toMatch(/validateRuntimeConfig\(\)[\s\S]*?process\.exit\(1\)/);
    // Guardrails must run before the database connection is opened. (Anchor
    // on the semicolon so the startup-sequence doc comment mentioning
    // "await connectDB()" at the top of the file cannot match.)
    const guardrailPos = serverSource.indexOf('validateRuntimeConfig()');
    const dbPos = serverSource.indexOf('await connectDB();');
    expect(guardrailPos).toBeGreaterThan(-1);
    expect(dbPos).toBeGreaterThan(guardrailPos);
  });
});
