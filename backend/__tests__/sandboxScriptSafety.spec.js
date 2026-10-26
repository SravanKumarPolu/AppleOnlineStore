// PayPal sandbox helper — safety interlocks.
//
// The helper exists to validate SANDBOX behaviour, but it builds a
// LiveEnvironment when PAYPAL_ENV=live. A `--create`/`--capture` run in that
// configuration would touch real money. These tests pin the refusal, without
// any network access.
import { describe, it, expect } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(backendRoot, 'scripts/paypal-sandbox-check.mjs');

async function run(args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: backendRoot,
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

describe('paypal-sandbox-check — cannot call live endpoints by accident', () => {
  it('refuses --create when PAYPAL_ENV=live', async () => {
    const result = await run(['--create'], { PAYPAL_ENV: 'live' });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/SANDBOX only/i);
    expect(result.stderr).toMatch(/refuses/i);
    // No PayPal request was attempted.
    expect(result.stdout).not.toMatch(/Creating a real PayPal order/i);
  });

  it('refuses --capture when PAYPAL_ENV=live', async () => {
    const result = await run(['--capture', 'FAKE-ORDER-ID'], { PAYPAL_ENV: 'live' });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/SANDBOX only/i);
    expect(result.stdout).not.toMatch(/Capturing/i);
  });
});
