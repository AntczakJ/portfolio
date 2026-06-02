/**
 * Client op-rate guard — ADR-010 §3 (B2).
 *
 * A token-bucket guard on Yjs op COMMITS (one `doc.transact` boundary =
 * one op, regardless of how many shapes it mutates). It sits well under
 * the server's `maxRate: 100` msgs/sec/client (ADR-002) so a runaway
 * client — a UI bug, or a future high-frequency tool — self-limits
 * gracefully BEFORE earning a server-issued `4290` close that the user
 * would experience as a disconnect.
 *
 * The guard is DEFENSIVE: with the per-tool commit contract (one
 * transact per gesture — freehand commits once on pointerup, paste is
 * one transact for N shapes), a normal user emits ~1 op/gesture and
 * never approaches the ceiling. Its job is graceful degradation under
 * abuse, not throttling legitimate use.
 *
 * Calibration is expressed as an explicit FRACTION of the server
 * ceiling so a future `maxRate` change prompts a recalibration here
 * (ADR-010 "two rate-limit surfaces that must stay calibrated").
 */

/**
 * Server backpressure ceiling (ADR-002). Mirrored here ONLY to derive
 * the client guard as a fraction of it + document the relationship; the
 * client never reads the server value at runtime.
 */
export const SERVER_MAX_RATE = 100;

/**
 * Sustained client op ceiling — 40% of the server ceiling. The 60%
 * headroom absorbs the non-shape traffic that shares the same per-client
 * rate budget (awareness coalescing, y-sync deltas) so the client guard
 * fires before the server's would.
 */
export const CLIENT_OP_RATE_CEILING = 40;

/**
 * Burst allowance — the bucket's capacity. Absorbs a legitimate burst
 * (a 50-shape paste is ONE op, but a rapid sequence of single-shape
 * commits should not be throttled) without tripping the cooldown.
 */
export const CLIENT_OP_BURST_ALLOWANCE = 20;

/** Dev `[meld-ops]` log cadence (ms). */
const DEV_OPS_LOG_INTERVAL_MS = 10_000;

export interface OpRateGuardResult {
  /**
   * `true` when the op is within budget and should be committed now.
   * `false` when the bucket is empty — the caller should coalesce /
   * briefly defer (ADR-010's "short cooldown before the server limit").
   */
  allowed: boolean;
  /** Bucket level AFTER this decision (for telemetry / tests). */
  tokens: number;
}

/**
 * Token-bucket rate guard. The bucket holds up to
 * `CLIENT_OP_BURST_ALLOWANCE` tokens and refills at
 * `CLIENT_OP_RATE_CEILING` tokens/sec. Each op consumes one token;
 * when empty, the op is deferred (the caller decides whether to retry
 * after the implied cooldown).
 *
 * Time is injected (`nowMs`) so tests drive it deterministically
 * without a real clock.
 */
export class OpRateGuard {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  #tokens: number;
  #lastRefillMs: number;

  // Dev telemetry — committed-op count + cooldown count in the current
  // window. Stripped from production by the NODE_ENV gate at the log
  // site (Terser DCE), same pattern as the engine's `[meld-engine]` log.
  #windowOps = 0;
  #windowCooldowns = 0;
  #windowStartMs: number;
  #lastLogMs: number;

  constructor(
    nowMs: number,
    capacity = CLIENT_OP_BURST_ALLOWANCE,
    ratePerSec = CLIENT_OP_RATE_CEILING,
  ) {
    this.#capacity = capacity;
    this.#refillPerMs = ratePerSec / 1000;
    this.#tokens = capacity;
    this.#lastRefillMs = nowMs;
    this.#windowStartMs = nowMs;
    this.#lastLogMs = nowMs;
  }

  /**
   * Attempt to spend one token for an op about to commit. Refills the
   * bucket based on elapsed time, then either consumes a token (allowed)
   * or reports the bucket empty (deferred).
   */
  tryConsume(nowMs: number): OpRateGuardResult {
    this.#refill(nowMs);
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      this.#windowOps += 1;
      this.#maybeLog(nowMs);
      return { allowed: true, tokens: this.#tokens };
    }
    this.#windowCooldowns += 1;
    this.#maybeLog(nowMs);
    return { allowed: false, tokens: this.#tokens };
  }

  /** Current bucket level (test aid). */
  get tokens(): number {
    return this.#tokens;
  }

  #refill(nowMs: number): void {
    const dt = nowMs - this.#lastRefillMs;
    if (dt <= 0) return;
    this.#lastRefillMs = nowMs;
    this.#tokens = Math.min(
      this.#capacity,
      this.#tokens + dt * this.#refillPerMs,
    );
  }

  #maybeLog(nowMs: number): void {
    // Dev-only `[meld-ops]` ops/sec telemetry. The NODE_ENV literal is
    // constant-folded by Next's DefinePlugin and the branch (including
    // the log + the format string) is DCE'd from the production bundle —
    // `grep .next/static/chunks` for `[meld-ops]` returns ZERO matches.
    if (process.env.NODE_ENV !== 'development') return;
    if (nowMs - this.#lastLogMs < DEV_OPS_LOG_INTERVAL_MS) return;
    const windowMs = Math.max(1, nowMs - this.#windowStartMs);
    const opsPerSec = (this.#windowOps / windowMs) * 1000;
    console.log(
      `[meld-ops] ops/sec=${opsPerSec.toFixed(2)} ` +
        `ops=${this.#windowOps.toString()} ` +
        `cooldowns=${this.#windowCooldowns.toString()} ` +
        `bucket=${this.#tokens.toFixed(1)}/${this.#capacity.toString()}`,
    );
    this.#windowOps = 0;
    this.#windowCooldowns = 0;
    this.#windowStartMs = nowMs;
    this.#lastLogMs = nowMs;
  }
}

/**
 * Convenience: read a monotonic clock. `performance.now()` where
 * available (browser + jsdom), `Date.now()` fallback.
 */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
