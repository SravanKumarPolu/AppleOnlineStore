// Shared app constants. Previously exported from App.tsx, which broke React
// Fast Refresh (a file exporting components must only export components).
//
// Resolution order (same contract as the storefront's config/backend.ts):
//   1. VITE_BACKEND_URL when set (absolute API host), trimmed, no trailing slash.
//   2. production build without it: `''` → same-origin. The admin container
//      proxies `/api/` and `/socket.io/` to `backend:3001`, so the bundle no
//      longer hardcodes `http://localhost:3001` (which pointed at the
//      visitor's machine in every deployed environment).
//   3. dev/test: the Vite dev server is on :5174 and the API on :3001.
const raw =
  typeof import.meta.env.VITE_BACKEND_URL === 'string'
    ? import.meta.env.VITE_BACKEND_URL.trim()
    : '';

export const backendUrl: string = raw
  ? raw.replace(/\/+$/, '')
  : import.meta.env.PROD
    ? ''
    : 'http://localhost:3001';

// `io(undefined)` targets the page origin; `io('')` would be a malformed URL.
export const socketUrl: string | undefined = backendUrl === '' ? undefined : backendUrl;

export const currency = '$';
