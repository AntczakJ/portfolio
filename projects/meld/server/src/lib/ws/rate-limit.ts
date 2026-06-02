import type {
  Extension,
  beforeHandleMessagePayload,
} from '@hocuspocus/server';

import { emitOverrunAndClose } from './overrun';
import { wsMetrics } from './metrics';
import type { MeldConnectionContext } from './server';

/**
 * Per-client token-bucket rate limit (Task 1.X-control — ADR-002
 * `maxRate: 100 msg/sec/client` enforcement gap noted in AGENT_NOTES
 * "Hocuspocus extension-hook quirks for backend-engineer day-one
 * instrumentation" + Task 1.4 notes).
 *
 * Token-bucket math:
 *
 *   - Bucket capacity: 100 tokens.
 *   - Refill rate:     100 tokens / 1000 ms = 1 token per 10 ms.
 *   - Initial state:   full (100 tokens) at connection open.
 *   - On each inbound message: try to decrement 1 token. If the bucket
 *     is empty, the message is rejected — the client is over the
 *     100 msg/sec ceiling.
 *
 *   The refill is computed lazily on each consume call: we record the
 *   wall-clock time of the last update and on the next call compute
 *   `tokens = min(capacity, tokens + floor((now - last) / refillMs))`.
 *   No setInterval timer per connection — refill is purely a function
 *   of (last access time, now). For an idle connection with a full
 *   bucket the refill is a no-op clamp.
 *
 * Why a token bucket and not a fixed-window count:
 *
 *   A fixed-window count (e.g., "100 messages per second walk-clock
 *   second") admits a 2× burst at the window boundary — 99 messages
 *   in the last 10 ms of one window plus 100 in the first 10 ms of
 *   the next is 199 messages in 20 ms but passes the fixed-window
 *   check. The token bucket admits ONE 100-burst (immediately
 *   refilled at 10 ms/token) but enforces the long-run rate strictly.
 *   For the wow-moment two-tab demo this means a brief click-spam
 *   burst (10-20 rapid shape edits) passes without false-positive
 *   close, while sustained 200 msg/sec spam triggers an immediate
 *   `control.overrun` + 4290 close.
 *
 * Per-`socketId` lookup:
 *
 *   `beforeHandleMessagePayload.socketId` is a stable identifier per
 *   WebSocket connection (assigned by Hocuspocus at handshake time).
 *   We key the bucket by socketId so two tabs of the same browser get
 *   independent budgets (each tab is its own connection per ADR-005
 *   multi-tab rule). Cleanup on disconnect uses Hocuspocus's
 *   `onDisconnect` hook — buckets for closed connections are erased
 *   from the Map so the memory footprint stays O(live connections).
 *
 * Documented divergence: ADR-002 named `maxRate` as a framework
 * config, but Hocuspocus 4.1's `Configuration` interface does NOT
 * surface a per-client rate limit. The enforcement therefore lives in
 * this extension via the `beforeHandleMessage` hook — the exact hook
 * name in 4.1 (verified against
 * `node_modules/@hocuspocus/server/dist/index.d.ts` line 365 and the
 * ESM source line 877 where `instance.beforeHandleMessage(...)` is
 * wired). No divergence from the brief; the name is exact.
 */

const TOKENS_PER_SECOND = 100;
const BUCKET_CAPACITY = 100;
// 1000 ms / 100 tokens = 10 ms / token. The computed value is
// re-derived inside `createRateLimitExtension` from the
// possibly-overridden `tokensPerSecond` option, so we don't keep an
// unused module-level constant here.

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

interface CreateOptions {
  /** Inject a clock for deterministic tests. */
  now?: () => number;
  /** Override bucket capacity (test-only). */
  capacity?: number;
  /** Override tokens-per-second (test-only). */
  tokensPerSecond?: number;
}

/**
 * Build a rate-limit extension instance. Production callers use the
 * default options; the factory shape exists so tests can drive
 * synthetic time without monkey-patching `Date.now()` and use small
 * capacities to keep test runtimes short.
 */
export function createRateLimitExtension(
  options: CreateOptions = {},
): Extension<MeldConnectionContext> {
  const now = options.now ?? (() => Date.now());
  const capacity = options.capacity ?? BUCKET_CAPACITY;
  const tokensPerSecond = options.tokensPerSecond ?? TOKENS_PER_SECOND;
  const refillIntervalMs = 1000 / tokensPerSecond;

  // Keyed by Hocuspocus `socketId` — one bucket per WebSocket
  // connection. Allocated on first message, freed on disconnect.
  const buckets = new Map<string, Bucket>();

  function consumeToken(socketId: string): boolean {
    const nowMs = now();
    let bucket = buckets.get(socketId);
    if (bucket === undefined) {
      bucket = { tokens: capacity, lastRefillMs: nowMs };
      buckets.set(socketId, bucket);
    } else {
      const elapsed = nowMs - bucket.lastRefillMs;
      if (elapsed > 0) {
        const refill = Math.floor(elapsed / refillIntervalMs);
        if (refill > 0) {
          bucket.tokens = Math.min(capacity, bucket.tokens + refill);
          bucket.lastRefillMs += refill * refillIntervalMs;
        }
      }
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
  }

  return {
    extensionName: 'meld-rate-limit',
    priority: 100,

    // eslint-disable-next-line @typescript-eslint/require-await
    async beforeHandleMessage(
      payload: beforeHandleMessagePayload<MeldConnectionContext>,
    ): Promise<void> {
      const ok = consumeToken(payload.socketId);
      if (!ok) {
        wsMetrics.recordRateLimited();
        // Emit the control.overrun frame (over Stateless per ADR-011)
        // BEFORE the framework
        // closes the connection on our throw. `emitOverrunAndClose`
        // also closes the raw socket with code 4290 — the throw is
        // belt-and-braces against any race where the framework
        // continues to process queued messages after the socket has
        // already started closing.
        emitOverrunAndClose(payload.connection, {
          reason: 'rate.exceeded',
          retryAfterMs: 1000,
        });
        // Throw with the 4290 close code so Hocuspocus's
        // `processMessages` catch clause closes via the same code.
        // The wire is already closed by `emitOverrunAndClose`; this
        // covers the framework-side bookkeeping.
        const err = new Error('rate limit exceeded');
        Object.assign(err, {
          code: 4290,
          reason: 'rate.exceeded',
        });
        throw err;
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async onDisconnect(payload): Promise<void> {
      // Hocuspocus's `onDisconnect` payload carries `socketId`. Drop
      // the bucket on disconnect so memory stays O(live connections).
      buckets.delete(payload.socketId);
    },
  };
}

/**
 * Default-options singleton — the production-wired instance used by
 * `server.ts`. Tests construct their own via the factory.
 */
export const rateLimitExtension = createRateLimitExtension();
