/**
 * Process-level resilience backstop (CRITICAL prod-crash fix, narrowed).
 *
 * This is a PUBLIC demo on a single Fly Machine. A single RECOVERABLE
 * async fault must never take the process down. The live incident that
 * motivated the original backstop: a concurrent-edit `op_seq` collision
 * rejected an unawaited `onChange` promise (Hocuspocus fires `onChange`
 * fire-and-forget), Node's default `unhandledRejection` policy printed
 * the version banner and exited, and the demo went fully down
 * (health 0/1, "instance refused connection on 0.0.0.0:3001").
 *
 * --- Policy (narrowed; supersedes the prior process-wide keep-alive) ---
 *
 * The two process hooks are deliberately ASYMMETRIC, because the two
 * fault classes are not equivalent:
 *
 *   - `unhandledRejection` -> LOG + STAY ALIVE.
 *     A rejected promise that escaped to here is, by construction, one we
 *     did not await. It cannot have torn a half-applied SYNCHRONOUS
 *     transaction in the in-process state — the throwing frame already
 *     unwound and returned a (rejected) promise. This is the exact shape
 *     of the incident (an unawaited `onChange` DB rejection). The
 *     recoverable classes — a dropped/retried DB write, a delayed
 *     snapshot flush — are all re-derivable: y-websocket re-syncs the op
 *     on the next client update; the next debounce window re-flushes the
 *     snapshot. Crashing loses every live board's in-memory room;
 *     surviving does not. Staying up is correct here.
 *
 *   - `uncaughtException` -> LOG + BOUNDED GRACE FLUSH + `process.exit(1)`.
 *     Node explicitly documents that resuming after an arbitrary
 *     `uncaughtException` leaves the process in an UNDEFINED state: a
 *     synchronous throw can abandon a half-mutated object, a half-written
 *     buffer, a lock not released. Swallowing it process-wide masks
 *     genuinely fatal faults and hides real bugs. The CORRECT recovery
 *     for an undefined-state process is a clean platform restart: we log
 *     full structured detail, run a best-effort flush bounded by a short
 *     timeout (so a hung flush cannot wedge the process), then exit
 *     non-zero. Fly restarts the Machine on a non-zero exit, which brings
 *     up a process in a known-good state. The in-memory rooms are lost,
 *     but they are reconstructed from the persisted ops-log on the next
 *     client reconnect — the same recovery path the rejection branch
 *     relies on, just with a process restart in front of it.
 *
 * The per-boundary `try/catch` (`changeImpl`, the `.catch` on every
 * `void storeDocumentHooks(...)`, `connectImpl`) remains the FIRST line of
 * defense and is unchanged — these handlers are only the last-resort net.
 * Recoverable async faults are caught at the boundary and never reach
 * here; what reaches `uncaughtException` is, by definition, the surprising
 * case we did not anticipate, and the safe answer to a surprise in an
 * undefined-state process is "restart", not "keep going".
 *
 * Boot-time fail-closed throws (empty `MELD_ALLOWED_ORIGINS` in
 * production, missing `DATABASE_URL`) are evaluated at MODULE LOAD, before
 * the event loop hands control back, and are NOT delivered to
 * `uncaughtException` — they abort the process directly as today. This
 * narrowing does not touch that path, nor the SIGINT/SIGTERM graceful
 * shutdown (`process.exit(0)`), which is a separate handler.
 */

/** Exit code used when an uncaught exception forces a platform restart. */
export const UNCAUGHT_EXCEPTION_EXIT_CODE = 1;

/**
 * How long the uncaught-exception handler waits for the best-effort flush
 * before forcing the exit regardless. Bounded so a hung flush (e.g. a
 * Postgres socket that never settles) cannot wedge the process in a
 * zombie state — the whole point of exiting is to escape an
 * undefined-state process, so the exit must not itself be blockable.
 */
export const UNCAUGHT_EXCEPTION_GRACE_MS = 500;

/** What the process should do for a given fault class. */
export type ResilienceAction = 'stay-alive' | 'exit-after-grace';

export type FaultKind = 'unhandledRejection' | 'uncaughtException';

/**
 * Pure policy function — extracted so the decision is unit-testable
 * without spawning a process or installing real handlers.
 *
 * Asymmetric by design (see the module docblock):
 *   - `unhandledRejection`  -> stay alive (recoverable, did-not-await).
 *   - `uncaughtException`   -> exit after a bounded grace (undefined state).
 */
export function decideResilienceAction(kind: FaultKind): ResilienceAction {
  return kind === 'unhandledRejection' ? 'stay-alive' : 'exit-after-grace';
}

/**
 * Dependencies the installer needs, injected so tests can supply fakes
 * (a fake `process`, a captured logger, a synchronous timer) and assert
 * the policy without touching the real event loop.
 */
export interface ResilienceDeps {
  /** The process to attach handlers to + exit through. */
  proc: Pick<NodeJS.Process, 'on' | 'exit'>;
  /** Structured error sink. Defaults to `console.error`. */
  logError?: (message: string, detail: unknown) => void;
  /**
   * Best-effort flush invoked before an `uncaughtException` exit. May
   * return a promise; it is raced against {@link UNCAUGHT_EXCEPTION_GRACE_MS}.
   * Defaults to a no-op.
   */
  flush?: () => void | Promise<void>;
  /** Injectable timer (defaults to `setTimeout`) for the grace bound. */
  setTimer?: (cb: () => void, ms: number) => unknown;
}

/**
 * Installs the two process-level handlers per {@link decideResilienceAction}.
 *
 * - `unhandledRejection`: logs and returns — the process stays alive.
 * - `uncaughtException`: logs, kicks off the best-effort flush, and exits
 *   `UNCAUGHT_EXCEPTION_EXIT_CODE` after at most `UNCAUGHT_EXCEPTION_GRACE_MS`
 *   (whichever of flush-complete or timeout fires first). The exit is
 *   guarded against double-firing if both the flush and the timer resolve.
 */
export function installProcessResilience(deps: ResilienceDeps): void {
  const {
    proc,
    logError = (message, detail) => {
      console.error(message, detail);
    },
    flush = () => undefined,
    setTimer = (cb, ms) => setTimeout(cb, ms),
  } = deps;

  proc.on('unhandledRejection', (reason: unknown) => {
    // stay-alive branch: a not-awaited rejection. Log and continue.
    logError(
      '[meld-server] unhandledRejection (kept alive — recoverable, not awaited):',
      reason,
    );
  });

  proc.on('uncaughtException', (err: unknown) => {
    // exit-after-grace branch: undefined process state. Log, flush
    // best-effort within a bounded window, then hand recovery to the
    // platform (Fly restarts on a non-zero exit).
    logError(
      '[meld-server] uncaughtException (undefined state — flushing then exiting for platform restart):',
      err,
    );

    let exited = false;
    const exitOnce = (): void => {
      if (exited) return;
      exited = true;
      proc.exit(UNCAUGHT_EXCEPTION_EXIT_CODE);
    };

    // Hard cap: exit no later than the grace window, even if `flush`
    // hangs. `unref` is intentionally NOT used — we WANT this timer to
    // keep the loop alive just long enough to fire the exit.
    setTimer(exitOnce, UNCAUGHT_EXCEPTION_GRACE_MS);

    // Best-effort flush; exit as soon as it settles (success or failure)
    // rather than waiting out the full grace window unnecessarily.
    void Promise.resolve()
      .then(() => flush())
      .then(exitOnce, (flushErr: unknown) => {
        logError('[meld-server] uncaughtException flush failed:', flushErr);
        exitOnce();
      });
  });
}
