// Dangling-object audit (scripts/audit-dangling-blobs.mjs) — pure-function
// coverage. The CLI itself needs a real .git directory, but the parsing and the
// LIVE/STALE classification are the security-relevant parts: a false "STALE"
// would hide a live credential inside an unreachable blob (AGENTS trap 22).
import { describe, it, expect } from '@jest/globals';
import {
  extractAssignments,
  classifyBlob,
  summarize,
  CREDENTIAL_KEYS,
} from '../scripts/audit-dangling-blobs.mjs';

describe('dangling-object audit', () => {
  it('parses env-style assignments, quotes, exports and inline comments', () => {
    const text = [
      'JWT_SECRET="quoted-value-1234567890"',
      'export ADMIN_PASSWORD=exported-value-1234567890',
      'MONGODB_URI=mongodb+srv://user:pass@cluster.example.net/db',
      'PAYPAL_CLIENT_SECRET=unquoted-value-1234567890 # trailing note',
    ].join('\n');

    const found = extractAssignments(text);

    expect(found.get('JWT_SECRET')).toBe('quoted-value-1234567890');
    expect(found.get('ADMIN_PASSWORD')).toBe('exported-value-1234567890');
    expect(found.get('MONGODB_URI')).toBe('mongodb+srv://user:pass@cluster.example.net/db');
    expect(found.get('PAYPAL_CLIENT_SECRET')).toBe('unquoted-value-1234567890');
  });

  it('parses minified JSON credential pairs on a single line', () => {
    const text = '{"JWT_SECRET":"json-secret-1234567890","PORT":3001,"SMTP_PASS":"json-smtp-1234567890"}';

    const found = extractAssignments(text);

    expect(found.get('JWT_SECRET')).toBe('json-secret-1234567890');
    expect(found.get('SMTP_PASS')).toBe('json-smtp-1234567890');
    expect(found.has('PORT')).toBe(false); // not a credential key
  });

  it('ignores keys outside the credential set and empty values', () => {
    const text = ['NODE_ENV=production', 'PORT=3001', 'JWT_SECRET='].join('\n');

    const found = extractAssignments(text);

    expect(found.size).toBe(0);
  });

  it('classifies an identical value as LIVE, a different one as STALE, a missing baseline as UNKNOWN', () => {
    const assignments = new Map([
      ['JWT_SECRET', 'same-value'],
      ['ADMIN_PASSWORD', 'changed-value'],
      ['SMTP_PASS', 'no-baseline'],
    ]);
    const current = new Map([
      ['JWT_SECRET', 'same-value'],
      ['ADMIN_PASSWORD', 'current-value'],
    ]);

    const rows = classifyBlob(assignments, current);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.state]));

    expect(byKey.JWT_SECRET).toBe('LIVE');
    expect(byKey.ADMIN_PASSWORD).toBe('STALE');
    expect(byKey.SMTP_PASS).toBe('UNKNOWN');
    // Lengths are reported, values never are.
    expect(rows.find((row) => row.key === 'JWT_SECRET').length).toBe('same-value'.length);
  });

  it('reports secrets and identifiers separately so a public id is not called a live secret', () => {
    const current = new Map([
      ['JWT_SECRET', 'live-secret'],
      ['PAYPAL_CLIENT_ID', 'public-id'],
    ]);
    const rows = classifyBlob(
      new Map([
        ['JWT_SECRET', 'live-secret'],
        ['PAYPAL_CLIENT_ID', 'public-id'],
        ['MONGODB_URI', 'old-uri'],
      ]),
      current
    );

    const report = summarize([{ sha: 'abcdef1234567890', rows }], true);

    expect(report.live.map((entry) => entry.key)).toEqual(['JWT_SECRET']);
    expect(report.liveIdentifiers.map((entry) => entry.key)).toEqual(['PAYPAL_CLIENT_ID']);
    expect(report.staleOrUnknown.map((entry) => entry.key)).toEqual(['MONGODB_URI']);
    expect(report.unverifiable).toHaveLength(0);
  });

  it('fails closed when no current baseline is available', () => {
    const rows = classifyBlob(new Map([['JWT_SECRET', 'any-value']]), null);

    const report = summarize([{ sha: 'abcdef1234567890', rows }], false);

    // Equality cannot be proven, so the secret must keep the gate red.
    expect(report.live).toHaveLength(0);
    expect(report.unverifiable.map((entry) => entry.key)).toEqual(['JWT_SECRET']);
  });

  it('covers every credential the backend actually reads', () => {
    for (const name of ['JWT_SECRET', 'ADMIN_PASSWORD', 'MONGODB_URI', 'PAYPAL_CLIENT_SECRET', 'CLOUDINARY_SECRET_KEY', 'SMTP_PASS']) {
      expect(CREDENTIAL_KEYS).toContain(name);
    }
  });
});
