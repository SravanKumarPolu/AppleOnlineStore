import {
  verifyAccessToken,
  resolveAccessIdentity,
  extractBearerToken,
  TOKEN_FAILURE,
} from '../utils/accessToken.js';

// HTTP authentication middleware.
//
// Both middlewares delegate claim verification to utils/accessToken.js — the
// same module Socket.IO uses — so a token can never be honoured on one
// transport and rejected on the other. This file only maps the shared failure
// reasons onto HTTP status codes and client-safe messages.

const rejectUnauthenticated = (res) =>
  res.status(401).json({
    success: false,
    message: 'Token is not valid',
  });

const rejectForbidden = (res, message) =>
  res.status(403).json({
    success: false,
    message,
  });

/**
 * Shopper middleware.
 *
 * Admin tokens (type:'admin', issued by POST /api/user/admin) carry no user id
 * and no tokenVersion binding, so they must never reach a shopper route: the
 * boundary is enforced centrally here instead of relying on every controller
 * to reject a null id.
 */
const authUser = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided',
      });
    }

    const verified = verifyAccessToken(token);
    if (!verified.ok) {
      return rejectUnauthenticated(res);
    }

    if (verified.decoded.type === 'admin') {
      return rejectForbidden(res, 'Admin tokens cannot access shopper endpoints');
    }

    const resolved = await resolveAccessIdentity(verified.decoded);
    if (!resolved.ok) {
      // The shoppers-facing messages are the historical ones: a missing or
      // deactivated account is an authentication failure, not a permission
      // failure, and a stale tokenVersion means "log in again".
      if (resolved.reason === TOKEN_FAILURE.INACTIVE || resolved.reason === TOKEN_FAILURE.UNKNOWN_USER) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive',
        });
      }
      if (resolved.reason === TOKEN_FAILURE.REVOKED) {
        return res.status(401).json({
          success: false,
          message: 'Session expired, please login again',
        });
      }
      return rejectUnauthenticated(res);
    }

    req.user = {
      id: resolved.identity.id,
      email: resolved.identity.email,
      role: resolved.identity.role,
    };
    req.auth = {
      tokenId: verified.decoded.jti ?? null,
      expiresAt: verified.decoded.exp ?? null,
    };

    return next();
  } catch (error) {
    console.error('Auth middleware error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

/**
 * Admin-only middleware.
 *
 * Accepts an admin token (type + role both required) or a shopper token whose
 * account carries the admin role — and, unlike before, re-checks the
 * tokenVersion on that second path so a password reset also revokes admin
 * access granted through a user token.
 */
const authAdmin = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided',
      });
    }

    const verified = verifyAccessToken(token);
    if (!verified.ok) {
      return rejectUnauthenticated(res);
    }

    const resolved = await resolveAccessIdentity(verified.decoded);
    if (!resolved.ok) {
      // Malformed admin claims are a permission problem (the signature was
      // valid); every other failure is an authentication problem.
      if (resolved.reason === TOKEN_FAILURE.INVALID_ADMIN_CLAIMS) {
        return rejectForbidden(res, 'Access denied. Admin privileges required.');
      }
      return rejectUnauthenticated(res);
    }

    if (resolved.identity.role !== 'admin') {
      return rejectForbidden(res, 'Access denied. Admin privileges required.');
    }

    req.user = {
      id: resolved.identity.id,
      email: resolved.identity.email,
      role: 'admin',
    };
    req.auth = {
      tokenId: verified.decoded.jti,
      expiresAt: verified.decoded.exp,
    };

    return next();
  } catch (error) {
    console.error('Admin auth middleware error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// Both named and default exports are provided so route files can use either
// import style consistently (`import authUser from ...` / `import { authUser } from ...`).
export { authUser, authAdmin };
export default authUser;
