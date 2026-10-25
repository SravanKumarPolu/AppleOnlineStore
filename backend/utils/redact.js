// Redaction helpers — keep credentials out of operational logs.
// Phase 1 security work area 3 + final gate Task 5.

// Matches mongodb://user:password@... and mongodb+srv://user:password@...
// Password may legally contain '@' — match greedily up to the LAST '@' on
// that LINE (the credential separator), bounded so the rest of the line
// contains no '@'. The lookahead is line-bounded (not string-bounded) so a
// later '@' on a DIFFERENT line (e.g. the same URI repeated in the stack, or
// an email address in the next log line) cannot prevent redaction here.
const MONGO_URI_CREDENTIALS_RE = /(mongodb(?:\+srv)?:\/\/)([^:@/\s]+):(.+)@(?=[^@\n]*(\n|$))/g;

// Bearer/Basic authorization headers embedded in logged strings.
const BEARER_CREDENTIALS_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g;

// JWT-shaped tokens (three dot-separated base64url segments).
const JWT_SHAPED_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function redactSecretShapedSubstrings(text) {
  return text
    .replace(MONGO_URI_CREDENTIALS_RE, '$1***:***@')
    .replace(BEARER_CREDENTIALS_RE, '$1 [REDACTED]')
    .replace(JWT_SHAPED_RE, '[REDACTED_JWT]');
}

/**
 * Redact credentials from a MongoDB connection URI.
 * Non-string input returns '' (never echoes the original value).
 */
export function redactMongoUri(uri) {
  if (typeof uri !== 'string') return '';
  return redactSecretShapedSubstrings(uri);
}

/**
 * Redact credential-shaped substrings from an arbitrary error/message.
 * Handles Error objects, strings, and anything else via String().
 */
export function redactError(err) {
  if (err === null || err === undefined) return String(err);
  const message = err instanceof Error ? err.message : String(err);
  return redactSecretShapedSubstrings(message);
}

/**
 * Redact credential-shaped substrings from arbitrary text — stacks, logged
 * payload dumps, multi-line error details. Error inputs contribute both the
 * message and the stack so nothing on the wire survives unredacted.
 */
export function redactText(value) {
  if (value === null || value === undefined) return String(value);
  const text = value instanceof Error ? `${value.message}\n${value.stack || ''}` : String(value);
  return redactSecretShapedSubstrings(text);
}

/**
 * Extract a host-only summary (no credentials) from a MongoDB URI,
 * for startup logs that want to show where they are connecting.
 */
export function summarizeMongoUri(uri) {
  const redacted = redactMongoUri(uri);
  try {
    const parsed = new URL(redacted);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return redacted;
  }
}
