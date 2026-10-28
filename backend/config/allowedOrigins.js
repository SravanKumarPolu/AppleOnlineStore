// Allowed browser origins — single source of truth for BOTH the Express CORS
// policy (app.js) and the Socket.IO CORS policy (services/socketService.js).
//
// Phase 4 audit outcome:
//   - The historical SKR e-commerce Netlify origins
//     (skr-e-commerce.netlify.app / admin-skr-e-commerce.netlify.app) were
//     HARDCODED. Nothing in the current frontend/admin references them (only
//     stale og:url metadata in frontend/index.html); production origins must
//     come from the environment instead (FRONTEND_URL / ADMIN_URL /
//     CORS_EXTRA_ORIGINS), so a deployment explicitly chooses its origins.
//   - Local development origins (Vite :5173/:5174 and legacy :3000) are
//     available outside production only.
//   - Socket.IO previously allowed extra localhost ports (5175/5176/5177)
//     that no current app uses; they are now covered by ADMIN_URL/FRONTEND_URL
//     environment configuration when needed, keeping both CORS lists in sync.
//
// Pure factory (no IO) so the CORS regression suite can drive the full matrix.
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

/**
 * Build the deduplicated list of allowed origins from the environment.
 * Values are trimmed and trailing slashes normalized so
 * "https://shop.example.com/" and "https://shop.example.com" both match.
 */
export function buildAllowedOrigins(env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const origins = isProduction ? [] : [...DEV_ORIGINS];

  for (const name of ['FRONTEND_URL', 'ADMIN_URL']) {
    const value = typeof env[name] === 'string' ? env[name].trim() : '';
    if (value) origins.push(value.replace(/\/+$/, ''));
  }

  // Optional comma-separated list for additional production origins
  // (e.g. a CDN domain or a second storefront host).
  const extras = typeof env.CORS_EXTRA_ORIGINS === 'string' ? env.CORS_EXTRA_ORIGINS : '';
  for (const raw of extras.split(',')) {
    const value = raw.trim();
    if (value) origins.push(value.replace(/\/+$/, ''));
  }

  return [...new Set(origins.filter(Boolean))];
}

export default buildAllowedOrigins;
