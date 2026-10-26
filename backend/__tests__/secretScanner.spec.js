// Secret scanner — fixture-exclusion hardening.
//
// The scanner used to skip all `NAME=value` checks under __tests__/ and
// *.spec.* files, so a real credential pasted into a spec would have been
// invisible. These cases lock the new rule: fixtures waive only obviously
// synthetic values, while credential-shaped patterns are never waived.
import { describe, it, expect } from '@jest/globals';

import { analyzeText, isFixturePath } from '../scripts/scan-secrets.mjs';

const FIXTURE = '__tests__/example.spec.js';
const SOURCE = 'backend/config/someConfig.js';

describe('secret scanner — fixture exclusions cannot hide real credentials', () => {
  it('treats test paths as fixtures but still scans them', () => {
    expect(isFixturePath(FIXTURE)).toBe(true);
  });

  it('reports a random-looking secret assigned inside a spec file', () => {
    // Fabricated at RUNTIME so this spec's own source never contains a
    // credential-shaped assignment (the scanner would rightly flag it).
    const fabricated = ['Zx9Qw7Er5Ty2Ui4Op6As8Df0Gh1Jk3Lm'].join('');
    const text = `const JWT_SECRET = "${fabricated}";`;
    const findings = analyzeText(text, FIXTURE);
    expect(findings.map((finding) => finding.kind)).toContain('assignment:JWT_SECRET');
  });

  it('waives obviously synthetic fixture values', () => {
    const text = [
      'const JWT_SECRET = "test-jwt-secret-for-the-suite";',
      'SMTP_PASS: "dummy-password",',
    ].join('\n');
    expect(analyzeText(text, FIXTURE)).toEqual([]);
  });

  it('never waives a credential-shaped PayPal secret, even in a fixture', () => {
    const fabricated = `PAYPAL_CLIENT_SECRET=E${'a'.repeat(64)}`;
    const findings = analyzeText(fabricated, FIXTURE);
    expect(findings.map((finding) => finding.kind)).toContain('paypal-secret');
  });

  it('reports a random-looking secret in ordinary source', () => {
    const fabricated = ['Q7m2Pz9Lx4Vb8Nc3Rt6Wy1Kg5'].join('');
    const text = `ADMIN_PASSWORD=${fabricated}`;
    const findings = analyzeText(text, SOURCE);
    expect(findings.map((finding) => finding.kind)).toContain('assignment:ADMIN_PASSWORD');
  });

  it('ignores placeholders and non-credential MongoDB URIs', () => {
    const text = [
      'JWT_SECRET=your-super-secret-jwt-key-here',
      'MONGODB_URI=mongodb://localhost:27017/novacart',
      'CLOUDINARY_SECRET_KEY=change-me',
    ].join('\n');
    expect(analyzeText(text, SOURCE)).toEqual([]);
  });

  it('flags a MongoDB URI that actually carries credentials', () => {
    const text = 'MONGODB_URI=mongodb+srv://appuser:s3cr3tpass@cluster.example.net/db';
    const findings = analyzeText(text, SOURCE);
    expect(findings.map((finding) => finding.kind)).toContain('assignment:MONGODB_URI');
  });
});

describe('secret scanner — expiry-aware jwt + env-reference rejection', () => {
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64u({ alg: 'HS256', typ: 'JWT' });
  const makeJwt = (claims) => [header, b64u(claims), 'c2lnbmF0dXJlLWZvci10ZXN0cw'].join('.');

  it('waives a PROVABLY EXPIRED jwt — it can never authenticate', () => {
    const expired = makeJwt({ id: '507f1f77bcf86cd799439011', exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(analyzeText(`const t = '${expired}';`, SOURCE)).toEqual([]);
  });

  it('still flags a jwt whose exp is in the future', () => {
    const live = makeJwt({ id: '507f1f77bcf86cd799439011', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(analyzeText(`const t = '${live}';`, SOURCE).map((f) => f.kind)).toContain('jwt');
  });

  it('fails closed on an undecodable jwt-looking string', () => {
    const undecodable = ['eyJ' + 'A'.repeat(20), 'eyJ' + 'B'.repeat(20), 'c'.repeat(20)].join('.');
    expect(analyzeText(`const t = '${undecodable}';`, SOURCE).map((f) => f.kind)).toContain('jwt');
  });

  it('does not flag a process.env reference as a secret value', () => {
    const text = 'const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;';
    expect(analyzeText(text, SOURCE)).toEqual([]);
  });
});
