/**
 * Per-connection inbound-message rate limiter (ADR-003 / security posture).
 *
 * The WS control channel is a public input surface (subscribe / unsubscribe /
 * snapshot.request / sim.control). `@fastify/rate-limit` guards the HTTP
 * surface and the UPGRADE request (connection rate), but it does not see
 * individual WS frames once the socket is open — so each connection carries its
 * own token bucket that throttles the rate of inbound frames it will process.
 *
 * A token-bucket (not a fixed window) smooths bursts: a client may send a short
 * burst (a few control frames on focus change) up to `burst`, then is limited to
 * the steady `ratePerSec`. Frames that arrive with no token are DROPPED (not
 * queued, not crashed on) — the honest "drop malformed/abusive client input"
 * rule. A pure, wall-clock-injectable implementation so it is unit-testable.
 */
export interface RateLimiterOptions {
  /** Steady-state tokens replenished per second. */
  readonly ratePerSec: number;
  /** Maximum tokens that can accumulate (the burst allowance). */
  readonly burst: number;
  /** Wall-clock source (injectable for tests). */
  readonly now?: () => number;
}

export class TokenBucket {
  private readonly ratePerSec: number;
  private readonly burst: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefill: number;

  constructor(options: RateLimiterOptions) {
    this.ratePerSec = options.ratePerSec;
    this.burst = options.burst;
    this.now = options.now ?? Date.now;
    this.tokens = options.burst;
    this.lastRefill = this.now();
  }

  /**
   * Try to consume one token. Returns true if allowed (a token was available),
   * false if the connection is over its rate (the frame should be dropped).
   */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = this.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.lastRefill = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
  }
}
