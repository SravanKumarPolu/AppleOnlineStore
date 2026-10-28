// Root-relative API base + socket URL.
//
// Why this module exists: every call site used to inline
// `import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'`. That fallback
// is correct for local development but wrong for the shipped container images:
// the Vite build runs without the variable (`.env` is excluded from the Docker
// build context), so the bundle hardcoded `http://localhost:3001` and the
// browser then called the *visitor's* localhost instead of the origin that
// served the page.
//
// Resolution order:
//   1. VITE_BACKEND_URL, when set (absolute API host, or `''`-free explicit
//      value) — trimmed, no trailing slash.
//   2. production builds: `''` → same-origin requests, which nginx proxies to
//      `backend:3001` (`/api/` + `/socket.io/`). No CORS, no hardcoded host.
//   3. development / test: the Vite dev server is on :5173 and the API on
//      :3001, so the historical localhost fallback is kept (the unit tests
//      assert request URLs against it).
const raw = typeof import.meta.env.VITE_BACKEND_URL === 'string'
  ? import.meta.env.VITE_BACKEND_URL.trim()
  : '';

export const backendUrl: string = raw
  ? raw.replace(/\/+$/, '')
  : import.meta.env.PROD
    ? ''
    : 'http://localhost:3001';

// `io(undefined)` targets the page origin; `io('')` would be a malformed URL.
export const socketUrl: string | undefined = backendUrl === '' ? undefined : backendUrl;

export default backendUrl;
