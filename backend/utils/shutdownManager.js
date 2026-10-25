// Graceful shutdown orchestration — Phase 1 work area 5 + final gate Task 3.
//
// Guarantees:
//  - idempotent: repeated SIGTERM/SIGINT (or manual re-invocation) is a no-op
//  - stops accepting new requests first (drain flag via callback)
//  - closes HTTP server, then WebSocket layer, then MongoDB, in order
//  - the timeout budget bounds the COMPLETE http -> sockets -> database
//    cleanup lifecycle: every phase is raced against the remaining deadline,
//    so a hanging close can never stall the chain past the budget
//  - timeouts are handled safely: an http-phase timeout force-destroys
//    lingering keep-alive sockets (closeAllConnections), later phases still
//    run with whatever budget remains, and `forced` / onForceExit tell the
//    caller to exit non-zero because cleanup did not complete cleanly
//
// Dependencies are injected so the logic is unit-testable without sockets.

const DEFAULT_TIMEOUT_MS = 10000;

export function createShutdownManager({
  server,
  onDrain,          // (shuttingDown: boolean) => void  — flips app drain middleware
  closeSockets,     // async () => void                  — closes socket.io
  closeDatabase,    // async () => void                  — closes mongoose
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
  onForceExit,      // (timedOutPhases: string[], reason) => void — notification hook
} = {}) {
  let inProgress = false;
  let completed = false;

  async function initiateShutdown(reason = 'unknown') {
    if (inProgress || completed) {
      logger.log(`🛑 Shutdown already in progress — duplicate signal (${reason}) ignored`);
      return { duplicate: true, completed };
    }
    inProgress = true;
    logger.log(`🛑 Graceful shutdown initiated (${reason})`);

    // ONE deadline for the whole http -> sockets -> database lifecycle.
    const deadline = Date.now() + timeoutMs;
    const timedOutPhases = [];

    // 1. Stop accepting new requests
    try {
      if (typeof onDrain === 'function') onDrain(true);
    } catch (drainError) {
      logger.error('Drain flag callback failed:', drainError?.message || drainError);
    }

    // 2. Close HTTP server — bounded by the full budget. On timeout the
    //    server stop is abandoned and lingering keep-alive sockets are
    //    force-destroyed so the process can actually exit.
    const httpOutcome = await new Promise((resolve) => {
      let settled = false;
      let forceTimer = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        resolve(result);
      };
      forceTimer = setTimeout(() => {
        timedOutPhases.push('http');
        if (typeof server?.closeAllConnections === 'function') {
          try {
            server.closeAllConnections();
          } catch {
            // best-effort destruction of lingering keep-alive sockets
          }
        }
        finish('timeout');
      }, timeoutMs);

      if (server && typeof server.close === 'function') {
        server.close(() => finish('closed'));
      } else {
        finish('no-server');
      }
    });

    // 3+4. Close WebSocket layer, then MongoDB — each raced against whatever
    // budget remains, so no single hanging close can consume the rest of the
    // lifecycle unboundedly. An http-phase timeout consumed the full budget
    // by definition, so later phases are skipped-and-reported (deterministic,
    // independent of timer-vs-clock jitter under load).
    const runBoundedPhase = async (phase, close) => {
      if (typeof close !== 'function') return;
      const remaining = deadline - Date.now();
      if (httpOutcome === 'timeout' || remaining <= 0) {
        timedOutPhases.push(phase);
        logger.error(`⏱️ ${phase} close skipped — shutdown budget exhausted`);
        return;
      }
      let timer = null;
      try {
        await Promise.race([
          Promise.resolve().then(close),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOutPhases.push(phase);
              reject(new Error(`${phase} close timed out after ${remaining}ms`));
            }, remaining);
            timer.unref?.();
          }),
        ]);
      } catch (phaseError) {
        logger.error(`${phase} close failed/timed out:`, phaseError?.message || phaseError);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    await runBoundedPhase('sockets', closeSockets);
    await runBoundedPhase('database', closeDatabase);

    completed = true;
    const forced = timedOutPhases.length > 0;
    if (forced) {
      logger.error(
        `⏱️ Shutdown timeout of ${timeoutMs}ms exceeded — cleanup incomplete (phases: ${timedOutPhases.join(', ')})`
      );
      // Safe timeout handling: the caller is notified (once) that cleanup did
      // not finish cleanly and should exit non-zero.
      if (typeof onForceExit === 'function') {
        try {
          onForceExit(timedOutPhases, reason);
        } catch (hookError) {
          logger.error('onForceExit callback failed:', hookError?.message || hookError);
        }
      }
    }
    logger.log(`✅ Graceful shutdown complete (http: ${httpOutcome}${forced ? ', forced' : ''})`);
    return { duplicate: false, completed: true, httpClose: httpOutcome, timedOutPhases, forced };
  }

  return {
    initiateShutdown,
    isShuttingDown: () => inProgress || completed,
  };
}

export default createShutdownManager;
