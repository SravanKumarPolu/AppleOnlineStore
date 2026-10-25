// Production guard for diagnostic endpoints — Phase 4.
//
// Applied BEFORE authentication middleware on debug routes so that, in
// production, the endpoint does not even reveal whether it exists
// (unauthenticated probes get 404, not 401/403).
//
// Policy:
//   - NODE_ENV=production  -> 404 for every caller, unless explicitly
//     re-enabled with ENABLE_DEBUG_ENDPOINTS=true
//   - anything else        -> passes through (authAdmin still applies)
export function debugEndpointGuard(req, res, next) {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG_ENDPOINTS !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return next();
}

export default debugEndpointGuard;
