/**
 * Per-IP WebSocket connection-count cap — Phase 6 deploy hardening.
 *
 * Sits in front of the WS accept path on `/ws/stream`. ADR-006 pinned
 * the per-client backpressure circuit breaker as the POST-accept policy
 * (256 KB / 2 s, drop-oldest tick coalescing on `cell.delta`). This
 * limiter is the PRE-accept second line of defence — it caps how many
 * concurrent sockets a single source IP can hold open at once, so a
 * malicious or buggy client cannot spin up thousands of subscribers
 * against a single Fly.io machine and starve real visitors.
 *
 * Defaults:
 *   - `WS_MAX_CONNECTIONS_PER_IP = 5` per source IP.
 *
 * Wire:
 *   - The Elysia `/ws/stream` `open` handler calls `allow(ip)` before
 *     registering with the connection registry. On `false`, the socket
 *     is closed immediately with code `1008` ("policy violation") and
 *     never enters the registry.
 *   - The same handler calls `release(ip)` from its `close` callback
 *     so the count decrements regardless of how the socket left
 *     (clean close, abnormal disconnect, server-initiated 4290
 *     overrun).
 *
 * Counter shape:
 *   - `Map<string, number>` keyed by IP. Entries are pruned to zero
 *     on `release` to bound memory under a churn workload (many
 *     short-lived connections from many IPs over a long uptime).
 *
 * Observability:
 *   - `rateLimitedCount` is a process-lifetime counter of accepts the
 *     limiter rejected. Surfaced on `/health.ws.wsRateLimitedCount`
 *     so operators can see abuse without ssh'ing into the box.
 *
 * Horizontal-scale note (v2):
 *   - In-memory map → single-machine only. Two Fly.io machines do
 *     NOT share state, so a misbehaving IP can open 5 sockets per
 *     machine. v2 horizontal scale-out would need a shared store
 *     (Redis SETNX, Fly's own distributed KV) or a per-edge limiter
 *     at the proxy layer. ADR-007 territory — not pre-allocated.
 */

/**
 * Default per-IP concurrent-connection cap. 5 is generous for a real
 * visitor (the demo has one WS per browser tab, and a power user might
 * have a dashboard + a debug tab + a mobile companion open against the
 * same NAT'd home IP) while tight enough to make a connection-flood
 * attack pay an actual cost per source IP. Overridable via
 * `WS_MAX_CONNECTIONS_PER_IP`.
 */
export const WS_MAX_CONNECTIONS_PER_IP_DEFAULT = 5;

/**
 * Resolves the per-IP cap from the env once at module load.
 * Non-numeric / non-positive overrides fall back to the default so a
 * typo does not silently uncap the limiter.
 */
function resolveCapFromEnv(): number {
  const raw = process.env.WS_MAX_CONNECTIONS_PER_IP;
  if (raw === undefined || raw === '') {
    return WS_MAX_CONNECTIONS_PER_IP_DEFAULT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return WS_MAX_CONNECTIONS_PER_IP_DEFAULT;
  }
  return Math.floor(parsed);
}

export interface WSRateLimitOptions {
  /** Override the env-resolved cap. Tests use this; production should not. */
  cap?: number;
}

export class WSRateLimit {
  readonly #cap: number;
  readonly #counts = new Map<string, number>();
  #rateLimitedCount = 0;

  constructor(options: WSRateLimitOptions = {}) {
    this.#cap = options.cap ?? resolveCapFromEnv();
  }

  /**
   * Probe + reserve in one call. Returns `true` if the IP is below
   * the cap (and the count is incremented), `false` otherwise (and
   * `rateLimitedCount` is incremented).
   *
   * The probe is atomic with the reservation so two near-simultaneous
   * accepts from the same IP cannot both pass a 4-of-5 check and end
   * up at 6 — there is no event-loop yield between the read and the
   * write.
   */
  allow(ip: string): boolean {
    const current = this.#counts.get(ip) ?? 0;
    if (current >= this.#cap) {
      this.#rateLimitedCount++;
      return false;
    }
    this.#counts.set(ip, current + 1);
    return true;
  }

  /**
   * Decrement the per-IP count on connection close. Idempotent
   * against duplicate closes — a release that would drop the count
   * below 0 is treated as a no-op (defensive against a hypothetical
   * double-close path in Elysia / Bun).
   *
   * Prunes the entry when it hits zero so the map's memory footprint
   * stays bounded under high IP-churn workloads.
   */
  release(ip: string): void {
    const current = this.#counts.get(ip);
    if (current === undefined || current <= 0) return;
    if (current === 1) {
      this.#counts.delete(ip);
      return;
    }
    this.#counts.set(ip, current - 1);
  }

  /**
   * Current count for an IP. Test-only — production code should not
   * need to peek (the limiter owns the policy). Returns 0 for unknown
   * IPs so callers do not have to nullcheck.
   */
  countFor(ip: string): number {
    return this.#counts.get(ip) ?? 0;
  }

  /** Process-lifetime rejection counter, surfaced on `/health.ws`. */
  get rateLimitedCount(): number {
    return this.#rateLimitedCount;
  }

  /** Resolved cap. Read-only after construction. */
  get cap(): number {
    return this.#cap;
  }

  /** Distinct IP count currently tracked. Test-only observability. */
  get trackedIpCount(): number {
    return this.#counts.size;
  }
}

/**
 * Process-singleton limiter. The Elysia handler reaches for this on
 * accept; tests reset via `__resetRateLimitForTests` (see below).
 */
let singleton: WSRateLimit | null = null;

export function getRateLimit(): WSRateLimit {
  singleton ??= new WSRateLimit();
  return singleton;
}

/**
 * Test-only reset. Not exported from the barrel; tests import this
 * file directly, mirroring the pattern in `connections.ts`.
 */
export function __resetRateLimitForTests(): void {
  singleton = null;
}
