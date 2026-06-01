/**
 * In-memory per-IP fixed-window rate limiter (Task 1.6).
 *
 * `POST /api/boards` is publicly callable with no auth (ADR-001 / ADR-005
 * — v1 has no accounts). Anyone with the demo URL can ask the server to
 * insert a row in `boards`. Without a cap, a single bad actor could
 * burst-create boards faster than the 30-day retention sweep (ADR-003)
 * can clean them. This limiter is the only abuse mitigation on the HTTP
 * board-create path.
 *
 * Shape differs from tape's `WSRateLimit` (which counts CONCURRENT
 * connections per IP and pairs with a `release(ip)` on close):
 *
 *   - tape limits live WS sockets — a per-IP semaphore.
 *   - meld limits HTTP CREATES per IP per window — a per-IP token-bucket
 *     surrogate using a fixed 1 h sliding-by-window-snap counter.
 *
 * Cap: 30 creates / 1 h / IP by default. A real visitor exercising the
 * "open a few boards over a session" pattern stays well under; an
 * attacker is bottlenecked to 720 boards/day/IP (cap × 24) without
 * coordinating across multiple IPs. Override via env var
 * `MELD_BOARD_CREATE_RATE_LIMIT_PER_HOUR`.
 *
 * Horizontal-scale note (v2):
 *
 *   - `Map<ip, { count, windowStart }>` is single-machine only. Two Fly
 *     Machines do NOT share state, so a misbehaving IP gets one bucket
 *     per machine. The Phase 6 ADR-006 deploy is single-machine
 *     (`min_machines_running = 1`, `auto_stop_machines = 'off'`) so v1
 *     is consistent. A shared store (Redis + INCR + EXPIRE, or Fly's
 *     distributed KV) is ADR-007 territory and not pre-allocated.
 *
 * Window semantics:
 *
 *   - Snap-to-window-start: every IP's window starts when its first
 *     request lands. After the window expires (current time exceeds
 *     `windowStart + windowMs`), the counter resets on the next access.
 *     This is simpler than a true sliding window and accepts a known
 *     edge case — an attacker can fire the cap, wait until just before
 *     the window flips, and fire again, effectively doubling at the
 *     boundary. The doubled rate (60 creates / 2 min around the flip)
 *     is still well inside Postgres write capacity and below what would
 *     trip a real alarm. The simplicity wins.
 *
 * Memory:
 *
 *   - Entries are NOT actively pruned. A long-uptime process with many
 *     distinct visitors could accumulate stale rows in the map. The
 *     hourly window means a stale row weighs ~24 bytes (key string +
 *     two numbers) and 1M unique IPs over a year of uptime is ~24 MB
 *     — well inside the 512 MB Fly Machine budget (ADR-006). Active
 *     pruning would be a v2 optimisation gated on a real RSS-growth
 *     observation, not a pre-emptive concern.
 */

/**
 * Default 30 board creations per hour per IP.
 *
 * 30 is generous for a real visitor opening boards as part of a portfolio
 * demo walkthrough and tight enough that a script-driven burst trips the
 * limiter in the first minute. Overridable via env so the deployment
 * ADR can tune it without a code change.
 */
export const BOARD_CREATE_RATE_LIMIT_PER_HOUR_DEFAULT = 30;

/**
 * Default window in milliseconds (1 hour). Not exported as an env knob —
 * the per-hour rhythm is the load-bearing semantic; changing it would
 * change what the operator's mental model of "30 per hour" means.
 */
const WINDOW_MS_DEFAULT = 60 * 60 * 1000;

interface WindowState {
  count: number;
  windowStart: number;
}

export interface IpRateLimitOptions {
  /** Override the env-resolved cap. Tests use this; production should not. */
  cap?: number;
  /** Override the 1 h window. Tests use this; production should not. */
  windowMs?: number;
  /** Inject a clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Resolve the per-IP-per-hour cap from the env once at construction.
 * Non-numeric / non-positive overrides fall back to the default so a
 * typo does not silently uncap the limiter.
 */
function resolveCapFromEnv(): number {
  const raw = process.env.MELD_BOARD_CREATE_RATE_LIMIT_PER_HOUR;
  if (raw === undefined || raw === '') {
    return BOARD_CREATE_RATE_LIMIT_PER_HOUR_DEFAULT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return BOARD_CREATE_RATE_LIMIT_PER_HOUR_DEFAULT;
  }
  return Math.floor(parsed);
}

export class IpRateLimit {
  readonly #cap: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, WindowState>();
  #rejectedCount = 0;

  constructor(options: IpRateLimitOptions = {}) {
    this.#cap = options.cap ?? resolveCapFromEnv();
    this.#windowMs = options.windowMs ?? WINDOW_MS_DEFAULT;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Probe + record in one call. Returns `true` if the IP is under the
   * cap for the current window (and the count is incremented), `false`
   * otherwise (and `rejectedCount` is incremented).
   *
   * The increment is part of the same call as the check so two near-
   * simultaneous requests from the same IP cannot both read the count
   * at N-1 and end up at N+1 — Node is single-threaded between awaits,
   * and `allow()` has no awaits.
   *
   * Snap-to-window-start: if the existing bucket's `windowStart` is
   * older than `windowMs` ago, we start a fresh window at the current
   * time. This is the documented edge case under "Window semantics" in
   * the module header.
   */
  allow(ip: string): boolean {
    const now = this.#now();
    const existing = this.#buckets.get(ip);
    if (existing === undefined || now - existing.windowStart >= this.#windowMs) {
      this.#buckets.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (existing.count >= this.#cap) {
      this.#rejectedCount++;
      return false;
    }
    existing.count++;
    return true;
  }

  /**
   * Current count for an IP within its active window. Returns 0 when
   * the IP has no bucket or its bucket has expired. Test-only — production
   * code should not need to peek.
   */
  countFor(ip: string): number {
    const existing = this.#buckets.get(ip);
    if (existing === undefined) return 0;
    if (this.#now() - existing.windowStart >= this.#windowMs) return 0;
    return existing.count;
  }

  /** Process-lifetime rejection counter — surfaceable on `/health` if useful. */
  get rejectedCount(): number {
    return this.#rejectedCount;
  }

  /** Resolved cap. Read-only after construction. */
  get cap(): number {
    return this.#cap;
  }

  /** Resolved window length in milliseconds. Read-only after construction. */
  get windowMs(): number {
    return this.#windowMs;
  }

  /** Distinct IP count currently tracked. Test-only observability. */
  get trackedIpCount(): number {
    return this.#buckets.size;
  }
}

/**
 * Process-singleton limiter for `POST /api/boards`. The Hono route
 * reaches for this on every create; tests reset via the dedicated
 * helper below.
 */
let singleton: IpRateLimit | null = null;

export function getBoardCreateRateLimit(): IpRateLimit {
  singleton ??= new IpRateLimit();
  return singleton;
}

/**
 * Test-only reset. Not exported from a barrel; tests import this file
 * directly, mirroring tape's `__resetRateLimitForTests` pattern.
 */
export function __resetBoardCreateRateLimitForTests(): void {
  singleton = null;
}

/**
 * Extract a best-effort client IP from a Hono context-equivalent header
 * bag. Reads `x-forwarded-for` first (Fly populates it at the edge per
 * ADR-006) and takes the first comma-separated entry (the original
 * client per RFC 7239), falling back to a literal `'unknown'` when no
 * header is present (e.g., local dev with no proxy).
 *
 * The 'unknown' bucket is shared across all unattributed callers — in
 * production that bucket should stay empty because Fly always sets the
 * header; in dev it may accumulate calls but is a single global cap
 * which is fine for local testing.
 *
 * Exported as a pure function so the route handler and tests share one
 * implementation and the parsing rule is testable in isolation.
 */
export function extractClientIp(
  headers: { get(name: string): string | null },
): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return 'unknown';
}
