/**
 * Reconnect / restart backoff helper — Task 1.4a per ADR-004.
 *
 * Single source of truth for the curve both the bridge-client reconnect
 * loop and the worker supervisor ride. Exponential from
 * `BRIDGE_BACKOFF_INITIAL_MS` to `BRIDGE_BACKOFF_MAX_MS` with ±20% jitter.
 * `reset()` is called from the consumer when a fresh `connected` event
 * lands; after `BRIDGE_BACKOFF_RESET_HEALTHY_MS` of uninterrupted
 * connectivity the consumer must reset so a later flap does not start
 * from the cap.
 */

import {
  BRIDGE_BACKOFF_INITIAL_MS,
  BRIDGE_BACKOFF_JITTER,
  BRIDGE_BACKOFF_MAX_MS,
} from './config';

export interface BackoffOptions {
  /** Initial delay in ms. Defaults to `BRIDGE_BACKOFF_INITIAL_MS`. */
  initialMs?: number;
  /** Cap on the per-step delay in ms. Defaults to `BRIDGE_BACKOFF_MAX_MS`. */
  maxMs?: number;
  /** Symmetric jitter fraction. Defaults to `BRIDGE_BACKOFF_JITTER`. */
  jitter?: number;
  /** Random source — injectable for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
}

export class Backoff {
  readonly #initialMs: number;
  readonly #maxMs: number;
  readonly #jitter: number;
  readonly #random: () => number;
  #attempt = 0;

  constructor(options: BackoffOptions = {}) {
    this.#initialMs = options.initialMs ?? BRIDGE_BACKOFF_INITIAL_MS;
    this.#maxMs = options.maxMs ?? BRIDGE_BACKOFF_MAX_MS;
    this.#jitter = options.jitter ?? BRIDGE_BACKOFF_JITTER;
    this.#random = options.random ?? Math.random;
  }

  /**
   * Return the delay for the next attempt and advance the attempt
   * counter. The returned value is already jittered — schedule a
   * timer for it directly.
   */
  nextDelayMs(): number {
    // 2 ^ attempt scaling, then cap. Use a bit-shift up to attempt 30
    // (well past anything the cap permits) to keep the math integer-clean.
    const exponent = Math.min(this.#attempt, 30);
    const base = Math.min(this.#initialMs * 2 ** exponent, this.#maxMs);
    this.#attempt += 1;
    if (this.#jitter <= 0) return base;
    const delta = base * this.#jitter;
    // (random()*2 - 1) is uniform on [-1, 1]; multiply by delta for
    // symmetric ±jitter.
    const jittered = base + (this.#random() * 2 - 1) * delta;
    return Math.max(0, Math.round(jittered));
  }

  /** Reset to the initial delay. Call on a confirmed healthy reconnect. */
  reset(): void {
    this.#attempt = 0;
  }

  /** Number of `nextDelayMs()` calls since the last `reset()`. */
  get attempt(): number {
    return this.#attempt;
  }
}
