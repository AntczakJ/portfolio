/**
 * Bridge transport configuration constants — Task 1.4a.
 *
 * Centralised so the supervisor and any future restart-policy consumers
 * (`/health`, integration tests, ops dashboards) read the same numbers.
 * Tweaks land here and propagate; do not duplicate these values at call
 * sites. The values are pinned by ADR-004 (worker supervision) and must
 * not be weakened without amending that ADR.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reconnect / restart backoff schedule (ADR-004).
 *
 *  - Start at 250 ms, double up to a 5 s cap, with ±20% jitter applied at
 *    each schedule. One mental model for the bridge-client reconnect and
 *    for the worker-supervisor respawn — both ride this curve.
 *  - Reset the schedule to the initial delay after `resetAfterHealthyMs`
 *    of continuous healthy operation. Without the reset a flaky day adds
 *    up to a several-second restart cliff which is worse UX than a
 *    deliberate fast retry after a known-good window.
 */
export const BRIDGE_BACKOFF_INITIAL_MS = 250;
export const BRIDGE_BACKOFF_MAX_MS = 5_000;
export const BRIDGE_BACKOFF_JITTER = 0.2;
export const BRIDGE_BACKOFF_RESET_HEALTHY_MS = 60_000;

/**
 * Worker-supervisor crash-loop circuit breaker (ADR-004).
 *
 * Ten respawns inside a 60 s rolling window flips the supervisor to
 * `'crashed'` and stops the restart loop. Operators see this on
 * `/health.worker.state` and must intervene; the bridge does not silently
 * keep burning CPU on a poisonous binary.
 */
export const BRIDGE_CRASH_LOOP_MAX = 10;
export const BRIDGE_CRASH_LOOP_WINDOW_MS = 60_000;

/**
 * Maximum decoded frame size on the wire. Anything above this is treated
 * as a desync (the length prefix is being read out of a payload) and the
 * reader throws. The largest realistic bridge frame is a full cell
 * snapshot at peak cell count — well under 64 KB even before MessagePack
 * compression. 1 MiB is a comfortable ceiling that catches corruption
 * without painting any realistic payload into the failure path.
 */
export const BRIDGE_MAX_FRAME_BYTES = 1024 * 1024;

/**
 * Resolve the path to a worker binary the supervisor spawns. The
 * `name` parameter picks which binary the worker target dir is
 * expected to host — `'echo'` for the Task 1.4a placeholder, `'worker'`
 * for the real Task 1.5 footprint aggregator.
 *
 *  - `BRIDGE_WORKER_BIN` env override wins (production containers can
 *    point at `/usr/local/bin/tape-worker`).
 *  - Otherwise default to the cargo build output relative to this file.
 *    Set `BRIDGE_WORKER_PROFILE=release` to pick `target/release/...`;
 *    anything else (including unset) selects `target/debug/...`.
 */
export function workerBinaryPath(name: 'echo' | 'worker'): string {
  const override = process.env.BRIDGE_WORKER_BIN;
  if (override && override.length > 0) {
    return override;
  }
  const profile =
    process.env.BRIDGE_WORKER_PROFILE === 'release' ? 'release' : 'debug';
  // `import.meta.url` lands at
  //   projects/tape/server/src/lib/bridge/config.ts
  // The worker target dir is at
  //   projects/tape/worker/target/<profile>/<name>[.exe]
  // Five `..` segments climb to projects/tape/.
  const here = dirname(fileURLToPath(import.meta.url));
  const workerTarget = resolve(here, '..', '..', '..', '..', 'worker', 'target', profile);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return resolve(workerTarget, `${name}${suffix}`);
}

/**
 * Back-compat alias used by the existing supervisor tests + Task 1.4a
 * smoke. Resolves the `echo` binary by default; Task 1.5 boot wiring in
 * `src/server.ts` constructs the production `WorkerSupervisor` with the
 * explicit `'worker'` binary via {@link workerBinaryPath}.
 */
export function defaultWorkerBinaryPath(): string {
  return workerBinaryPath('echo');
}

/**
 * Handshake timeout (ADR-004 + Task 1.5). The supervisor flips
 * `BridgeClient` state to `'connected'` only after a `WorkerReady`
 * frame arrives within this window. A miss transitions the supervisor
 * to `'crashed'` and the worker is restarted via the existing backoff.
 */
export const BRIDGE_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * Cadence at which the supervisor polls the worker for a snapshot to
 * refresh `/health.worker.cellsOpen` + `ticksProcessed`. ADR-006 prefers
 * polling over push because the worker's authoritative state lives in
 * its `Aggregator.snapshot()` call and the polling cost (~1 KB / 5 s)
 * is invisible at the v1 frame budget. Producers (the rollover timer +
 * the on-tick path) already push deltas; this is a metric-refresh hook.
 */
export const BRIDGE_SNAPSHOT_POLL_MS = 5_000;
