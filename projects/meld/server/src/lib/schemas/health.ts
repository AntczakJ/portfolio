import { z } from 'zod';

/**
 * Health endpoint response contract.
 *
 * Shared between server (validates outbound payload before send) and any
 * future client poller (validates inbound payload). Per docs/conventions.md
 * § 5, Zod schemas in `src/lib/schemas/` are the integration boundary.
 *
 * Task 1.2 extends the Phase 1.1 baseline with a `db` sub-shape carrying
 * the Postgres liveness probe result. Task 1.4 (ADR-002 Hocuspocus
 * bootstrap) adds the `/health.ws` endpoint — exposed as the
 * `wsHealthSchema` sub-shape here AND as a dedicated `/health.ws` route
 * in `server.ts` so observability tooling can scrape just the WS
 * surface without parsing the full `/health` envelope.
 *
 * Status field is a single-literal union. A future degraded mode would
 * add `'degraded'` or `'error'` literals; today `/health` returns 'ok'
 * even when the DB ping fails — `db.connected = false` is the structured
 * signal, not a top-level status flip. That matches tape's pattern.
 */

/**
 * Storage adapter sub-shape (Task 1.3 — ADR-003 hybrid ops-log +
 * debounced snapshot persistence).
 *
 * Process-lifetime counters exported by the Hocuspocus Storage adapter
 * via `storageMetrics.snapshot()` in `src/lib/ws/storage-metrics.ts`.
 * Exposed inline on `db.storage` of the `/health` envelope — ADR-003
 * deferred the question of a dedicated `/health.db` aggregate route
 * to v1.1; for v1 the nested key on the existing envelope is the
 * right surface (one curl, one parser).
 *
 *  - `snapshotCount`      — total `onStoreDocument` flushes.
 *  - `snapshotBytes`      — running total of bytes written via
 *                           `Y.encodeStateAsUpdate`. Divide by
 *                           `snapshotCount` for the running average
 *                           size (ADR-003 baseline ~25 KB for a
 *                           200-shape board).
 *  - `opsAppended`        — total `board_ops` inserts.
 *  - `compactionRuns`     — snapshot flushes that ALSO deleted at
 *                           least one superseded op (a snapshot
 *                           against a board with no new ops since
 *                           last flush does not increment this).
 *  - `replayFromOpsCount` — `onLoadDocument` calls that replayed at
 *                           least one op on top of the snapshot —
 *                           non-zero values name post-crash recovery
 *                           events.
 */
export const dbStorageSchema = z.object({
  snapshotCount: z.number().int().nonnegative(),
  snapshotBytes: z.number().int().nonnegative(),
  opsAppended: z.number().int().nonnegative(),
  compactionRuns: z.number().int().nonnegative(),
  replayFromOpsCount: z.number().int().nonnegative(),
  /**
   * Task 1.5 — compaction-sweep counters (DB-side, NOT WS-side):
   *
   *  - `compactionSweepRuns`        — process-lifetime total of background
   *                                    compaction-sweep RUNS (every 6 h
   *                                    backstop OR a manual `runSweepNow`).
   *                                    Distinct from `compactionRuns`
   *                                    which counts snapshot UPSERTs that
   *                                    also deleted at least one op,
   *                                    regardless of trigger.
   *  - `roomsCompactedThisSweep`    — number of rooms the LAST sweep
   *                                    triggered an early-flush on (NOT
   *                                    a process-lifetime sum). Used to
   *                                    answer "was the last sweep
   *                                    productive". The lifetime sum
   *                                    lives on `compactionRuns`.
   */
  compactionSweepRuns: z.number().int().nonnegative(),
  roomsCompactedThisSweep: z.number().int().nonnegative(),
});

export type DbStorage = z.infer<typeof dbStorageSchema>;

/**
 * Retention-sweep sub-shape (Task 1.5 — ADR-003 nightly inactive-board
 * deletion + ADR-004 `control.board-deleted` emit).
 *
 *  - `retentionDeletedCount` — process-lifetime total of `boards` rows
 *                              deleted by the daily 03:00 UTC sweep.
 *                              Cascades remove `board_ops` rows in the
 *                              same transaction; we do not count those
 *                              separately (the FK cascade is the
 *                              ratifying side effect).
 *  - `retentionEmittedCount` — process-lifetime total of
 *                              `control.board-deleted` TEXT frames the
 *                              sweep successfully sent before closing
 *                              live connections on deleted boards.
 *                              `wsMetrics.controlFramesOut` ALSO counts
 *                              these — `retentionEmittedCount` is the
 *                              attribution split so an operator can
 *                              tell sweep-emits from welcome-frame
 *                              emits at a glance.
 *  - `retentionLastRunMs`    — wall-clock ms epoch of the last sweep
 *                              run (boot or daily). `null` before the
 *                              first sweep.
 *
 * Lives on the `db` sub-shape because the retention sweep is a DB-side
 * concern (the WS broadcast is a side effect of the DB delete, not the
 * other way around).
 */
export const retentionHealthSchema = z.object({
  retentionDeletedCount: z.number().int().nonnegative(),
  retentionEmittedCount: z.number().int().nonnegative(),
  retentionLastRunMs: z.number().int().nonnegative().nullable(),
});

export type RetentionHealth = z.infer<typeof retentionHealthSchema>;

/**
 * Database liveness sub-shape.
 *
 *  - `connected = true`  → `SELECT 1` returned within the probe window
 *                          (100 ms by default — see `pingDb()` in
 *                          `src/db/index.ts`).
 *  - `connected = false` & `latencyMs = number` → the probe ran but
 *                          failed (connection refused, timeout, auth
 *                          error). `latencyMs` reflects how long we
 *                          waited before giving up — useful for
 *                          distinguishing "DB is slow" from "DB is
 *                          gone".
 *  - `connected = false` & `latencyMs = null` → no probe ran because
 *                          `DATABASE_URL` was unset. Distinct from a
 *                          failed probe so operators can tell
 *                          "misconfigured" from "broken".
 *  - `storage`           → Task 1.3 Storage-adapter counters (always
 *                          present; zero on a fresh process).
 *
 * The two-policy split (fail-fast on the runtime ingest path, tolerant
 * on `/health.db`) is documented in `src/db/index.ts` — `/health`
 * intentionally does NOT require Postgres to be reachable for the
 * endpoint to serve. The runtime ingest path (Tasks 1.3 / 1.4) is
 * fail-fast and that's the right policy there; `/health` is the dev
 * fingerprint that shows whether the env is wired, and refusing to
 * answer would hide more information than it surfaces.
 */
export const dbHealthSchema = z.object({
  connected: z.boolean(),
  latencyMs: z.number().int().nonnegative().nullable(),
  storage: dbStorageSchema,
  /**
   * Task 1.5 — daily retention-sweep counters. Lives on the `db`
   * sub-shape because the sweep's load-bearing side effect is the
   * Postgres delete; the WS broadcast is the user-facing side effect.
   */
  retention: retentionHealthSchema,
});

export type DbHealth = z.infer<typeof dbHealthSchema>;

/**
 * WebSocket sub-shape (Task 1.4 — ADR-002 `/health.ws`).
 *
 * Read from `meldWs.snapshot()`:
 *
 *   - `connectedClients` — `Hocuspocus.getConnectionsCount()` snapshot.
 *     Sums across all rooms.
 *   - `roomCount` — `Hocuspocus.getDocumentsCount()` — number of
 *     `Y.Doc` instances the framework currently holds in memory. A
 *     board with 30 s GC grace per ADR-002 stays in this map even after
 *     the last client disconnects, until the grace window expires.
 *   - `controlFramesOut` — process-lifetime total of successful
 *     control-frame sends. Task 1.X-control wires the increments.
 *   - `controlFramesDropped` — process-lifetime total of failed sends
 *     (serialization throw, socket closed before send lands).
 *   - `rateLimitedCount` — process-lifetime total of upgrade rejections
 *     (Origin allowlist miss in Task 1.4; future per-client rate-limit
 *     rejections in Task 1.X-control).
 *
 * Per ADR-004 + ADR-005 follow-ups, the schema will gain:
 *
 *   - `controlOverrunsTotal`, `protocolVersionMismatchesTotal`
 *     (ADR-004 Task 1.X-control-observability).
 *   - `sessionsDistinct`, `sessionsMintedWsTotal`
 *     (ADR-005 Task 1.7b observability extension).
 *
 * Adding fields to the schema is non-breaking; removing or renaming
 * would bump the `/health` contract version.
 */
export const wsHealthSchema = z.object({
  connectedClients: z.number().int().nonnegative(),
  roomCount: z.number().int().nonnegative(),
  controlFramesOut: z.number().int().nonnegative(),
  controlFramesDropped: z.number().int().nonnegative(),
  rateLimitedCount: z.number().int().nonnegative(),
  overrunDisconnectCount: z.number().int().nonnegative(),
});

export type WsHealth = z.infer<typeof wsHealthSchema>;

/**
 * Boards sub-shape (Task 1.6 — `POST /api/boards` ships alongside this
 * extension).
 *
 *  - `count = number` → `SELECT COUNT(*) FROM boards` succeeded; the
 *                       value is the row count at probe time. For v1
 *                       demo scale this is a cheap walk; the swap to a
 *                       materialised view or a running counter column
 *                       lives in the deployment / observability ADR
 *                       once the demo accumulates real traffic.
 *  - `count = null`   → no DB ping was attempted because
 *                       `DATABASE_URL` is unset (mirrors the `pingDb()`
 *                       tolerance policy), OR the count query threw
 *                       and was logged. Distinct from a zero-row result
 *                       so operators can tell "DB not wired" from
 *                       "freshly migrated".
 *
 * This field is operations-debugging only — not security-sensitive,
 * matches `/health`'s public-by-default posture (ADR-006 H-A) and the
 * tape precedent of exposing the same shape on `/health.bridge`.
 */
export const boardsHealthSchema = z.object({
  count: z.number().int().nonnegative().nullable(),
});

export type BoardsHealth = z.infer<typeof boardsHealthSchema>;

/**
 * Session-cookie middleware sub-shape (Task 1.7a + 1.7b — ADR-005).
 *
 * Read from `sessionMetrics.snapshot()`:
 *
 *  - `sessionsMintedThisProcess` — process-lifetime count of fresh-UUID
 *                                  mints by the HONO middleware.
 *                                  Increments once per cookie-less
 *                                  first-touch HTTP request.
 *  - `sessionsLoadedFromCookie` — process-lifetime count of
 *                                  returning-visitor HTTP cookie loads.
 *  - `wsSessionsLoadedFromCookie` — Task 1.7b: process-lifetime count
 *                                   of WS upgrade requests whose
 *                                   `Cookie:` header carried a valid
 *                                   `meld_session` UUID v4 that the
 *                                   Hocuspocus `onConnect` extension
 *                                   reused.
 *  - `wsSessionsMintedOnWsConnect` — Task 1.7b: process-lifetime count
 *                                    of WS upgrade requests where the
 *                                    cookie was absent or malformed and
 *                                    `onConnect` minted a fresh UUID v4.
 *                                    A non-zero v1 value indicates real
 *                                    cookie-disabled traffic on the WS
 *                                    path OR a deployment regression
 *                                    where the upstream HTTP middleware
 *                                    is not setting cookies for the WS
 *                                    upgrade origin.
 *  - `welcomeFramesFallback`     — Task 1.7b: process-lifetime count
 *                                  of welcome frames emitted with the
 *                                  degraded "FALLBACK" sentinel identity
 *                                  because `connection.context.session`
 *                                  was missing at emit time. v1 ceiling
 *                                  is zero; a non-zero value indicates
 *                                  the cookie-read extension did not run
 *                                  before the welcome-emit extension
 *                                  (extension order regression) or the
 *                                  cookie-read extension threw before
 *                                  populating the context.
 *
 * HTTP mint + load sum approximates HTTP request volume through the
 * cookie middleware. WS mint + load sum approximates the WS upgrade
 * volume. The four counters split by transport so operators can
 * distinguish "HTTP cookie middleware is firing as expected" from "WS
 * `onConnect` cookie-read is firing as expected" at a glance.
 */
export const sessionHealthSchema = z.object({
  sessionsMintedThisProcess: z.number().int().nonnegative(),
  sessionsLoadedFromCookie: z.number().int().nonnegative(),
  wsSessionsLoadedFromCookie: z.number().int().nonnegative(),
  wsSessionsMintedOnWsConnect: z.number().int().nonnegative(),
  welcomeFramesFallback: z.number().int().nonnegative(),
});

export type SessionHealth = z.infer<typeof sessionHealthSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  commit: z.string().min(1),
  ts: z.number().int().positive(),
  db: dbHealthSchema,
  ws: wsHealthSchema,
  boards: boardsHealthSchema,
  session: sessionHealthSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Standalone `/health.ws` response — same shape as the `ws` sub-field
 * on `/health` plus an envelope. Wraps the snapshot in a `{ status,
 * commit, ts, ws }` shell mirroring `/health` so existing health-check
 * tooling can poll either endpoint with the same parser logic.
 */
export const wsHealthResponseSchema = z.object({
  status: z.literal('ok'),
  commit: z.string().min(1),
  ts: z.number().int().positive(),
  ws: wsHealthSchema,
});

export type WsHealthResponse = z.infer<typeof wsHealthResponseSchema>;
