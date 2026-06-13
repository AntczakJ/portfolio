import { z } from 'zod';

/**
 * Health endpoint response contract.
 *
 * Shared between server (validates outbound payload before send) and any
 * future client poller (validates inbound payload). Per docs/conventions.md
 * § 5, Zod schemas in src/lib/schemas/ are the integration boundary.
 *
 * Sub-schemas are pulled out so future observability hooks can extend the
 * shape without churning the top-level object literal.
 *
 * ADR-004 + Task 1.4a: the `worker` sub-shape is the observability hook
 * for the supervised Rust worker. The supervisor singleton is constructed
 * at server boot but is NOT started by `app.listen()` — Task 1.5 owns the
 * spawn wiring once the real worker binary exists. Until then `state`
 * reads `'idle'`, `pid` reads `null`, and the counters all read `0`. Tests
 * call `start()` / `stop()` explicitly. The full ADR-004 envelope
 * (`uptimeSec`, `generation`, `lastExitReason`, `overflowDropCount`)
 * lands incrementally with Tasks 1.5c / 1.5d — the four fields below are
 * the minimum surface the supervisor implements today.
 */

/**
 * Database liveness sub-shape.
 *
 *  - `connected = true`  → `SELECT 1` returned within the probe window.
 *  - `connected = false` & `latencyMs = number` → the probe ran but failed
 *     (connection refused, timeout, auth error). `latencyMs` reflects how
 *     long we waited before giving up — useful for distinguishing "DB is
 *     slow" from "DB is gone".
 *  - `connected = false` & `latencyMs = null` → no probe ran because the
 *     `DATABASE_URL` env var was unset. Distinct from a failed probe so
 *     operators can tell "misconfigured" from "broken".
 *
 * Partition-create observability — `partitionCreateLagDays`:
 *
 *  Count of days the rolling tick-partition creator is behind today.
 *  Computed by Task 1.2b's daily 03:00 UTC scheduler as
 *  `max(0, today - latest_existing_partition_upper_bound_day)`. A healthy
 *  steady-state value is 0 (the create-ahead loop maintains 2+ months of
 *  forward partitions, so "today" is always covered).
 *
 *  Thresholds for alerting (consumed by external monitors, not enforced
 *  by this schema):
 *    - 0       — nominal, the create-ahead loop is keeping up.
 *    - 1 .. 2  — warning; the scheduler likely missed one tick (e.g.
 *                container restart at 03:00 UTC). Self-heals on the
 *                next sweep window.
 *    - > 2     — critical; the create-ahead loop is wedged and the
 *                next month boundary will fail tick inserts with
 *                "no partition of relation 'ticks' found for row". The
 *                tick batcher's paranoia path (Task 1.2b) will recover
 *                inline once, but a sustained positive value here means
 *                manual intervention is needed.
 *
 *  Task 1.2a stubbed the value at 0; Task 1.2b wires it from the
 *  retention scheduler's lag computation (`computePartitionCreateLagDays`
 *  in `src/lib/ingest/retention-scheduler.ts`). Reserved on the contract
 *  in 1.2a so Eden Treaty type-propagates to `tape-web` before the value
 *  is real — analogous to ADR-004's `worker` field deferral (which stays
 *  absent here because the worker does not exist yet, while
 *  partitionCreateLagDays ships immediately because the field's
 *  _structure_ is load-bearing for the client even when the value is a
 *  placeholder).
 *
 * Tick-ingest observability — `tickBatchFlushCount`:
 *
 *  Cumulative count of successful `COPY ticks FROM STDIN` flushes since
 *  process start. A flush counts as one regardless of how many ticks it
 *  carries; a flush is not counted when the ring buffer was empty (no
 *  work done). Maintained by `TickWriter.flushCount` in
 *  `src/lib/ingest/tick-writer.ts` and read at response time.
 *
 *  Zero on a fresh process. Increases monotonically by ~20/s in steady
 *  state (one flush per 50 ms coalescing window, only when the ring is
 *  non-empty — at 200 ticks/s the ring is reliably non-empty every
 *  window). A stagnant value past the first few seconds of ingest is a
 *  signal that the writer is stuck (DB unreachable, partition missing,
 *  COPY back-pressure pathological). The counter blanks on restart by
 *  design — a v2 metric pipeline owns durable counters.
 */
export const dbHealthSchema = z.object({
  connected: z.boolean(),
  latencyMs: z.number().int().nonnegative().nullable(),
  partitionCreateLagDays: z.number().int().nonnegative(),
  tickBatchFlushCount: z.number().int().nonnegative(),
});

export type DbHealth = z.infer<typeof dbHealthSchema>;

/**
 * Worker supervisor sub-shape per ADR-004 + Task 1.4a.
 *
 *  - `state` mirrors `WorkerSupervisor.state` — `'idle'` before the
 *    supervisor is started, `'crashed'` after the 10-in-60s circuit
 *    breaker trips (operator must intervene).
 *  - `pid` is `null` until a worker process is alive.
 *  - `restartCount` is the cumulative respawn count since the
 *    supervisor was constructed (NOT cleared by `start` / `stop`).
 *  - `lastExitCode` records the most recent child-process exit code;
 *    `null` if the child has never exited or if Bun could not report a
 *    code (e.g. spawn failure).
 *
 * The remaining ADR-004 envelope (`uptimeSec`, `generation`,
 * `lastExitReason`, `overflowDropCount`) is intentionally NOT shipped
 * here — those fields are wired alongside the real worker spawn in
 * Tasks 1.5c / 1.5d. Reserved structurally because the Eden Treaty
 * client must see the field land in one shape and stay there; absent is
 * safer than a stubbed value that lies about a counter the supervisor
 * does not yet maintain.
 */
export const workerHealthSchema = z.object({
  state: z.enum([
    'idle',
    'connecting',
    'connected',
    'reconnecting',
    'stopping',
    'crashed',
  ]),
  pid: z.number().int().positive().nullable(),
  restartCount: z.number().int().nonnegative(),
  lastExitCode: z.number().int().nullable(),
  /**
   * Count of cells the worker currently holds in its open-bar map
   * across every symbol (Task 1.5). Read from the cached latest
   * `SnapshotPayload` the supervisor polls on `BRIDGE_SNAPSHOT_POLL_MS`;
   * reads `0` when the pipeline is not running (worker pipeline mode
   * disabled, supervisor in `idle` / `crashed` state, or no snapshot
   * has arrived yet on a fresh boot).
   */
  cellsOpen: z.number().int().nonnegative(),
  /**
   * Cumulative count of ticks the worker has processed since it last
   * started (Task 1.5). Resets to 0 on every worker respawn — the
   * counter is owned by the worker process, not by the supervisor, so
   * a restart blanks it. Sustained zero past the first second of
   * ingest signals the bridge is up but ticks are not reaching the
   * worker (network gap, schema mismatch, supervisor mid-restart).
   */
  ticksProcessed: z.number().int().nonnegative(),
});

export type WorkerHealth = z.infer<typeof workerHealthSchema>;

/**
 * WebSocket fan-out sub-shape per ADR-006 + Task 1.6b.
 *
 * Six observability counters maintained by the in-process
 * `WSConnectionRegistry` + `SnapshotCache` + `WSRateLimit` singletons:
 *
 *  - `connectedClients`         — live socket count. Resets to 0 on
 *                                  process restart (v1 simplification:
 *                                  no durable connection state).
 *  - `framesPerSecOut`          — outbound broadcast rate to all
 *                                  clients combined, sliding 5 s
 *                                  window. Non-negative, may be
 *                                  fractional. Heartbeat frames count.
 *  - `droppedFrameCount`        — cumulative per-client drop count
 *                                  since process start, summed across
 *                                  the drop-oldest-tick path AND the
 *                                  cell-delta coalesce path (coalesce
 *                                  surfaces the saved frame as a
 *                                  "dropped" one). Monotone.
 *  - `overrunDisconnectCount`   — cumulative count of clients
 *                                  force-disconnected by the ADR-006
 *                                  circuit breaker (256 KB / 2 s).
 *                                  Monotone. A non-zero number here
 *                                  on a quiet day usually means a
 *                                  client backgrounded its tab and
 *                                  triggered `memory.budget`.
 *  - `snapshotCacheHitRate`     — running ratio of "served a non-empty
 *                                  snapshot from cache" over "total
 *                                  connect events since process
 *                                  start". `null` before the first
 *                                  connect — distinguishes "no data
 *                                  yet" from "0 % hit rate".
 *  - `wsRateLimitedCount`       — cumulative count of accepts rejected
 *                                  by the per-IP pre-accept limiter
 *                                  (`WSRateLimit`, Phase 6 deploy
 *                                  hardening). Monotone. Distinct
 *                                  signal from `overrunDisconnectCount`
 *                                  — rate-limited connections never
 *                                  entered the registry at all, while
 *                                  overrun disconnects were accepted
 *                                  and then evicted by the per-client
 *                                  circuit breaker.
 *
 * v1 limitation documented in ADR-006: every counter blanks on
 * process restart. The cache itself is in-memory only. The rate
 * limiter's state is in-memory and per-process — see the module
 * docblock for the v2 horizontal-scale caveat.
 */
export const wsHealthSchema = z.object({
  connectedClients: z.number().int().nonnegative(),
  framesPerSecOut: z.number().nonnegative(),
  droppedFrameCount: z.number().int().nonnegative(),
  overrunDisconnectCount: z.number().int().nonnegative(),
  snapshotCacheHitRate: z.number().min(0).max(1).nullable(),
  wsRateLimitedCount: z.number().int().nonnegative(),
});

export type WsHealth = z.infer<typeof wsHealthSchema>;

/**
 * Binance Futures ingestion sub-shape per Task 1.3.
 *
 * Five observability counters maintained by the
 * `BinanceIngestor` + `BinanceFuturesClient` + `IngestSession`
 * singletons.
 *
 *  - `connected`     — true if the upstream WS is currently in the
 *                       `'connected'` state. Flips to false during a
 *                       reconnect-with-backoff cycle and back on the
 *                       next successful `open`. Resets to false on
 *                       process restart (v1 in-memory only).
 *  - `lastTickTsMs`  — Binance trade time of the last successfully
 *                       parsed aggTrade, ms since epoch. `null` until
 *                       the first event lands. Useful for distinguishing
 *                       "connected but no trades flowing" from "trade
 *                       just arrived". Resets to null on process
 *                       restart.
 *  - `parseErrors`   — Cumulative count of frames that failed JSON
 *                       parsing or Zod validation since process start.
 *                       Monotone. A non-zero value here usually means
 *                       Binance added a field, sent a control frame
 *                       this version does not know about, or the
 *                       network corrupted a frame — investigate at
 *                       the >0 → sustained-growth transition.
 *  - `restartCount`  — Cumulative count of automatic reconnect
 *                       attempts since process start. Monotone. A
 *                       single increment on container start is
 *                       harmless (Binance occasionally closes the
 *                       initial stream within ~1 s); sustained growth
 *                       is a feed problem.
 *  - `sessionId`     — UUID of the currently open session row in
 *                       `sessions`, `null` if the ingestor is not
 *                       running. Persistence-level fingerprint for
 *                       correlating live ingest with the durable
 *                       tick archive.
 *
 * When `BINANCE_WS_ENABLED=0`, the ingestor is not constructed and
 * the entire sub-shape reads as the "absent producer" baseline:
 * `{ connected: false, lastTickTsMs: null, parseErrors: 0,
 *    restartCount: 0, sessionId: null }`. The dev synthesizer
 * (`WS_SYNTHESIZE=1`) drives the WS path in that mode but does not
 * touch this sub-shape — it is exclusively the Binance ingest
 * observability surface.
 */
export const binanceHealthSchema = z.object({
  connected: z.boolean(),
  lastTickTsMs: z.number().int().positive().nullable(),
  parseErrors: z.number().int().nonnegative(),
  restartCount: z.number().int().nonnegative(),
  sessionId: z.string().min(1).nullable(),
});

export type BinanceHealth = z.infer<typeof binanceHealthSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  commit: z.string().min(1),
  ts: z.number().int().nonnegative(),
  db: dbHealthSchema,
  worker: workerHealthSchema,
  ws: wsHealthSchema,
  binance: binanceHealthSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
