// Server orchestration — Phase 1 work area 4/5.
//
// The express app itself lives in app.js (importable without side effects).
// This module owns the startup sequence and shutdown lifecycle:
//   await connectDB() -> cloudinary -> socket.io -> listen -> signal handlers
// Startup fails fast (redacted logs, exit 1) when required initialization
// fails, so the server never reports ready before its dependencies are up.
import 'dotenv/config';

import { createServer } from 'http';
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';

import app, { setShuttingDown } from './app.js';
import connectCloudinary from './config/cloudinary.js';
import connectDB from './config/mongodb.js';
import { validateRuntimeConfig, formatStartupConfigReport } from './config/startupValidation.js';
import socketService from './services/socketService.js';
import { createShutdownManager } from './utils/shutdownManager.js';
import { redactError } from './utils/redact.js';
import {
  startReservationSweeper,
  runInventorySweep,
  DEFAULT_SWEEP_INTERVAL_MS,
} from './services/reservationService.js';

const server = createServer(app);
let stopReservationSweeper = null;
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Process-level safety nets (no unhandled promise rejection crashes)
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled promise rejection:', redactError(reason));
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', redactError(error));
  // Unrecoverable state — flush what we can and exit non-zero.
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown wiring
// ---------------------------------------------------------------------------
const shutdownManager = createShutdownManager({
  server,
  onDrain: setShuttingDown,
  closeSockets: async () => {
    if (stopReservationSweeper) {
      stopReservationSweeper();
      stopReservationSweeper = null;
    }
    if (typeof socketService.close === 'function') {
      await socketService.close();
    }
  },
  closeDatabase: async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
  },
  timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000,
  // Final gate Task 3 — notification hook only; the exit decision comes from
  // the result returned by initiateShutdown().
  onForceExit: (phases, signal) => {
    console.error(
      `🚨 Cleanup phases exceeded the shutdown budget (${phases.join(', ')} on ${signal}) — exiting uncleanly`
    );
  },
});

function handleSignal(signal) {
  shutdownManager
    .initiateShutdown(signal)
    .then((result) => {
      // Final gate Task 3 — exit non-zero when cleanup did not complete
      // within the shutdown budget, so orchestrators/logs surface the
      // unclean shutdown instead of treating it as graceful.
      process.exit(result?.forced ? 1 : 0);
    })
    .catch((error) => {
      console.error('Shutdown error:', redactError(error));
      process.exit(1);
    });
}

process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));

// ---------------------------------------------------------------------------
// Startup sequence — every required step is awaited before listening.
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    // Credential guardrails run FIRST: a live payment configuration with
    // missing/placeholder credentials, or a production build without a JWT
    // secret, must refuse to boot before any resource is opened. Warnings
    // (staging topologies, partial sandbox config) are logged loudly but do
    // not block startup — they make the deployment's choices visible.
    const configReport = validateRuntimeConfig();
    for (const line of formatStartupConfigReport(configReport)) {
      console.log(`🔧 STARTUP CONFIG: ${line}`);
    }
    if (configReport.fatal.length > 0) {
      console.error(
        '🛑 Refusing to start: fix the FATAL CONFIG variables named above and redeploy.'
      );
      process.exit(1);
    }

    await connectDB();          // required: fail-fast if unreachable

    // Release inventory held by abandoned PayPal checkouts, and retry any
    // restoration that previously failed. One sweep at boot (so a restart
    // heals stale holds AND owed stock credits) and then on an interval. The
    // timer is unref'd; the stop handle is registered for graceful shutdown.
    await runInventorySweep().catch((error) => {
      console.error('Startup inventory sweep failed:', redactError(error));
    });
    stopReservationSweeper = startReservationSweeper({
      intervalMs: Number(process.env.RESERVATION_SWEEP_INTERVAL_MS) || DEFAULT_SWEEP_INTERVAL_MS,
    });
    await connectCloudinary();  // config-only call, kept after DB per original order
    socketService.initialize(server);

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '0.0.0.0', () => resolve());
    });

    console.log(`🚀 Server started on PORT: ${PORT}`);
    console.log(`🌍 ENV: ${process.env.NODE_ENV}`);
    console.log(`🌐 Server listening on http://0.0.0.0:${PORT}`);
  } catch (error) {
    console.error('❌ Startup failed:', redactError(error));
    process.exit(1);
  }
}

// Support `node server.js` and programmatic use in tests alike.
const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startServer();
}

export { app, server, startServer, shutdownManager };
export default startServer;
