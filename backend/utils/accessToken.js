// Single access-token verification path for BOTH transports.
//
// Before this module, `middleware/auth.js` (HTTP) and
// `services/socketService.js` (Socket.IO) each implemented their own JWT
// handling. They had already drifted:
//   - the socket layer verified with NO algorithm allow-list, so any algorithm
//     jsonwebtoken could support for the configured key was accepted;
//   - the socket layer trusted `type:'admin'` without checking `role`, so a
//     token carrying the type but not the role reached the admin room;
//   - the socket layer never compared `tokenVersion`, so a password reset
//     revoked the HTTP session but left every live socket authenticated;
//   - `authAdmin`'s user-token branch skipped the tokenVersion check.
//
// Both transports now call the same two functions, so a claim can never be
// honoured by one transport and rejected by the other.
//
// Results are discriminated objects (`{ ok: true } | { ok: false, reason }`)
// rather than exceptions: each transport maps the reason to its own wire
// format (HTTP status/message, Socket.IO error message) without sharing
// error strings that could leak details.
import jwt from 'jsonwebtoken';
import userModel from '../models/userModel.js';
import { isSessionRevoked } from '../services/sessionRevocationService.js';

// The only signing algorithms this application issues. Pinning the list is what
// prevents algorithm-confusion attacks (e.g. an attacker re-signing a payload
// with a different algorithm the key material happens to support).
export const JWT_ALGORITHMS = ['HS256'];

/** Reason codes shared by both transports (never sent verbatim to a client). */
export const TOKEN_FAILURE = Object.freeze({
  MISSING: 'missing',
  MISCONFIGURED: 'misconfigured',
  EXPIRED: 'expired',
  INVALID: 'invalid',
  UNKNOWN_USER: 'unknown_user',
  INACTIVE: 'inactive',
  REVOKED: 'revoked',
  INVALID_ADMIN_CLAIMS: 'invalid_admin_claims',
  FORBIDDEN: 'forbidden',
});

/**
 * Verify a raw JWT: signature, algorithm allow-list and expiry.
 * @returns {{ok: true, decoded: object} | {ok: false, reason: string}}
 */
export function verifyAccessToken(token, secret = process.env.JWT_SECRET) {
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, reason: TOKEN_FAILURE.MISSING };
  }
  if (typeof secret !== 'string' || secret === '') {
    // A missing secret is a deployment error, never an authentication success.
    return { ok: false, reason: TOKEN_FAILURE.MISCONFIGURED };
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: JWT_ALGORITHMS });
    if (!decoded || typeof decoded !== 'object') {
      return { ok: false, reason: TOKEN_FAILURE.INVALID };
    }
    if (!Number.isInteger(decoded.exp) || decoded.exp <= Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: TOKEN_FAILURE.INVALID };
    }
    return { ok: true, decoded };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === 'TokenExpiredError' ? TOKEN_FAILURE.EXPIRED : TOKEN_FAILURE.INVALID,
    };
  }
}

/**
 * Turn a verified payload into an identity, re-reading server-side state so a
 * token minted before a revocation cannot outlive it.
 *
 * - admin tokens (`{ type:'admin', role:'admin', email }`) carry no user id and
 *   are bounded by their 1-day expiry; they still must prove BOTH the type and
 *   the role, and an email is required for audit logs.
 * - shopper tokens (`{ id, tv? }`) are re-checked against the user document:
 *   existing, active, and pinned to the current `tokenVersion`.
 *
 * @returns {{ok: true, identity: object} | {ok: false, reason: string}}
 */
export async function resolveAccessIdentity(decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return { ok: false, reason: TOKEN_FAILURE.INVALID };
  }

  if (decoded.type === 'admin') {
    if (
      decoded.role !== 'admin' ||
      typeof decoded.email !== 'string' ||
      decoded.email.trim() === '' ||
      typeof decoded.jti !== 'string' ||
      decoded.jti.trim() === ''
    ) {
      return { ok: false, reason: TOKEN_FAILURE.INVALID_ADMIN_CLAIMS };
    }
    if (await isSessionRevoked(decoded.jti)) {
      return { ok: false, reason: TOKEN_FAILURE.REVOKED };
    }
    const email = decoded.email.trim();
    return {
      ok: true,
      identity: { kind: 'admin', id: null, email, role: 'admin', tokenId: decoded.jti },
    };
  }

  if (
    (decoded.type !== undefined && decoded.type !== 'user') ||
    !decoded.id ||
    (decoded.jti !== undefined &&
      (typeof decoded.jti !== 'string' || decoded.jti.trim() === ''))
  ) {
    return { ok: false, reason: TOKEN_FAILURE.INVALID };
  }

  if (decoded.jti && (await isSessionRevoked(decoded.jti))) {
    return { ok: false, reason: TOKEN_FAILURE.REVOKED };
  }

  let user;
  try {
    user = await userModel
      .findById(decoded.id)
      .select('_id email role isActive tokenVersion');
  } catch {
    // Malformed ObjectId in the claim — treat exactly like an unknown user so
    // the caller answers 401 instead of 500.
    return { ok: false, reason: TOKEN_FAILURE.UNKNOWN_USER };
  }

  if (!user) {
    return { ok: false, reason: TOKEN_FAILURE.UNKNOWN_USER };
  }
  if (!['user', 'admin'].includes(user.role)) {
    return { ok: false, reason: TOKEN_FAILURE.INVALID };
  }
  if (user.isActive === false) {
    return { ok: false, reason: TOKEN_FAILURE.INACTIVE };
  }

  // AF-2 session invalidation. Tokens without a `tv` claim predate the feature
  // and count as version 0, so the rollout does not log out existing sessions.
  const tokenVersion = Number.isInteger(decoded.tv) ? decoded.tv : 0;
  if (tokenVersion !== (user.tokenVersion ?? 0)) {
    return { ok: false, reason: TOKEN_FAILURE.REVOKED };
  }

  return {
    ok: true,
    identity: {
      kind: 'user',
      id: String(user._id),
      email: user.email,
      role: user.role,
      tokenId: typeof decoded.jti === 'string' ? decoded.jti : null,
    },
  };
}

/** Extract a bearer token from an HTTP-style header bag or a Socket.IO handshake. */
export function extractBearerToken(headers = {}) {
  const direct = headers.token;
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim();

  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.trim() !== '') {
    const value = authorization.trim();
    return value.startsWith('Bearer ') ? value.slice(7).trim() : value;
  }
  return null;
}

export default { verifyAccessToken, resolveAccessIdentity, extractBearerToken, JWT_ALGORITHMS };
