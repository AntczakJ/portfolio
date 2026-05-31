/**
 * WS heartbeat — Task 1.6b per ADR-006.
 *
 * Periodic server-pushed `control.heartbeat` frame so the browser
 * can detect a half-open TCP connection during a quiet market without
 * waiting on a real tick to arrive. The frame carries
 * `framesPerSecOut` so the browser can also surface a "feed slow"
 * indicator if the rate collapses to ~0 while heartbeats keep
 * firing — useful diagnostic UX when the upstream Binance feed
 * stalls.
 *
 * Cadence: every 5 s when at least one client is connected. Cheaper
 * to skip the broadcast entirely than to run a no-op `for ()` loop
 * over an empty registry, but the heartbeat module owns that gate
 * so callers do not have to.
 *
 * The heartbeat is broadcast through the registry's `broadcast` path
 * which itself counts into the `framesPerSecOut` sliding window —
 * heartbeats are first-class outbound frames, NOT excluded from the
 * rate metric. The browser's "feed slow" check therefore needs to
 * watch ticks-per-sec separately (Task 2.6 owns that wire-up).
 */

import type { WSConnectionRegistry } from './connections';

export const WS_HEARTBEAT_INTERVAL_MS = 5_000;

export interface HeartbeatLoopOptions {
  registry: WSConnectionRegistry;
  /** Override default 5 s interval. */
  intervalMs?: number;
  /** Inject clock for tests. */
  now?: () => number;
  /** Inject timer for tests. */
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export class HeartbeatLoop {
  readonly #registry: WSConnectionRegistry;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #setInterval: (cb: () => void, ms: number) => unknown;
  readonly #clearInterval: (h: unknown) => void;
  #timer: unknown = null;
  #running = false;

  constructor(options: HeartbeatLoopOptions) {
    this.#registry = options.registry;
    this.#intervalMs = options.intervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#setInterval =
      options.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this.#clearInterval =
      options.clearInterval ??
      ((h) => {
        clearInterval(h as ReturnType<typeof setInterval>);
      });
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timer = this.#setInterval(() => {
      this.tick();
    }, this.#intervalMs);
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#timer !== null) this.#clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Emit one heartbeat. Public so tests can drive the cadence
   * manually without a real timer.
   *
   * No-ops when no clients are connected — the heartbeat exists to
   * tell live clients the server is alive; without clients there is
   * nothing to tell.
   */
  tick(): void {
    if (this.#registry.connectedClients === 0) return;
    this.#registry.broadcast({
      topic: 'control',
      kind: 'control.heartbeat',
      payload: {
        serverTsMs: this.#now(),
        framesPerSecOut: this.#registry.framesPerSecOut(),
      },
    });
  }

  get isRunning(): boolean {
    return this.#running;
  }
}
