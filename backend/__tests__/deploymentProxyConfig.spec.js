// Deployment proxy contract.
//
// The realtime path crosses two nginx containers and one Docker network, which
// no unit test can exercise without Docker. What CAN be locked is the
// configuration that makes it work — and every line below has already been
// wrong once:
//   - admin/nginx.conf served static files only (no /api, no /socket.io), so
//     the panel's same-origin build had no upstream;
//   - `Connection "upgrade"` was hardcoded, which breaks the polling fallback
//     (a plain HTTP request must not advertise an upgrade);
//   - compose started the proxies before the API was healthy.
//
// If Docker IS available the runtime check is still the authority; this spec
// only prevents the config from silently rotting.
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const readRepoFile = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const FRONTEND_NGINX = 'frontend/nginx.conf';
const ADMIN_NGINX = 'admin/nginx.conf';
const COMPOSE = 'compose.yaml';

describe('nginx Socket.IO proxy', () => {
  for (const file of [FRONTEND_NGINX, ADMIN_NGINX]) {
    describe(file, () => {
      it('proxies /socket.io/ to the backend service on 3001', () => {
        const config = readRepoFile(file);

        expect(config).toMatch(/location\s+\/socket\.io\/\s*\{/);
        const socketBlock = config.slice(config.indexOf('location /socket.io/'));
        expect(socketBlock).toMatch(/proxy_pass\s+http:\/\/backend:3001;/);
        expect(socketBlock).toMatch(/proxy_http_version\s+1\.1;/);
      });

      it('forwards the WebSocket upgrade from the map, never hardcoded', () => {
        const config = readRepoFile(file);

        // The map is required for the polling fallback to stay a normal
        // request ('' -> close) while upgrades get "upgrade".
        expect(config).toMatch(/map\s+\$http_upgrade\s+\$connection_upgrade\s*\{/);
        expect(config).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
        expect(config).toMatch(/proxy_set_header\s+Connection\s+\$connection_upgrade;/);
        expect(config).not.toMatch(/proxy_set_header\s+Connection\s+"upgrade";/);
      });

      it('disables response buffering and allows long-lived connections', () => {
        const config = readRepoFile(file);
        const socketBlock = config.slice(config.indexOf('location /socket.io/'));

        expect(socketBlock).toMatch(/proxy_buffering\s+off;/);
        expect(socketBlock).toMatch(/proxy_read_timeout\s+3600s;/);
      });

      it('proxies /api/ so a same-origin build reaches the API', () => {
        const config = readRepoFile(file);

        expect(config).toMatch(/location\s+\/api\/\s*\{/);
        const apiBlock = config.slice(config.indexOf('location /api/'));
        expect(apiBlock).toMatch(/proxy_pass\s+http:\/\/backend:3001;/);
      });
    });
  }

  it('keeps a SPA fallback in both containers', () => {
    for (const file of [FRONTEND_NGINX, ADMIN_NGINX]) {
      expect(readRepoFile(file)).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/);
    }
  });
});

describe('compose topology', () => {
  it('defines the three services with a healthcheck each', () => {
    const compose = readRepoFile(COMPOSE);

    for (const service of ['backend', 'frontend', 'admin']) {
      expect(compose).toMatch(new RegExp(`^  ${service}:$`, 'm'));
    }
    // One healthcheck per service: the proxies must not be considered ready
    // before their upstream is, and the app must not be restarted mid-boot.
    expect(compose.match(/healthcheck:/g)).toHaveLength(3);
  });

  it('starts the proxies only after the API is healthy', () => {
    const compose = readRepoFile(COMPOSE);
    const conditions = compose.match(/condition:\s*service_healthy/g) || [];

    expect(conditions).toHaveLength(2);
  });

  it('gives the backend a shutdown window longer than its own drain budget', () => {
    const compose = readRepoFile(COMPOSE);

    // SHUTDOWN_TIMEOUT_MS defaults to 10 s; Docker's default 10 s SIGKILL
    // would cut the drain short and skip the socket/DB close phases.
    expect(compose).toMatch(/stop_grace_period:\s*30s/);
  });

  it('never opens CORS with a wildcard', () => {
    const compose = readRepoFile(COMPOSE);

    expect(compose).not.toMatch(/CORS_EXTRA_ORIGINS:\s*["']?\*["']?\s*$/m);
  });
});
