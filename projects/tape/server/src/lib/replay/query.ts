import { getSql } from '../../db';
import type { ReplayCellRow } from '../schemas/replay/cell';
import type { ReplayTickRow } from '../schemas/replay/tick';
import type { ReplayBounds, TickWindow } from './bounds';

/**
 * Replay read path — streams aggregated footprint cells and the raw-tick
 * tail straight from Postgres (ADR-005 § "Read path split": replay reads
 * Postgres ONLY; live reads worker memory only — the two paths never
 * touch each other). Task 1.7.
 *
 * **Streaming, not buffer-then-send.** ADR-005 § "Replay query shape"
 * pins ~72K cell rows for a worst-case day. Materialising all 72K rows in
 * a JS array before responding would spike RSS against the 7-day
 * uninterrupted-run / < 50 MB-growth success criterion and add first-byte
 * latency. We use the postgres-js server-side cursor (`.cursor(n)`) which
 * holds an open portal and pulls `n` rows per round-trip — memory stays
 * flat at one batch regardless of day size. The route wraps these
 * generators in a `ReadableStream` so Bun's `ServerWebSocket`/HTTP layer
 * flushes each NDJSON chunk as it is produced.
 *
 * **Index / ordering (ADR-005 / Task 1.2a).** The cell query orders by
 * `(bucket_ts, price_bucket)` and filters `symbol = $1 AND bucket_ts >=
 * $2 AND bucket_ts < $3`. This is served by the existing
 * `footprint_cells_symbol_bucket_ts_idx` btree on `(symbol, bucket_ts)`
 * (the PK's leading `symbol` column + this index narrow the scan; the
 * trailing `price_bucket` sort is resolved from the PK
 * `(symbol, bucket_ts, price_bucket)` ordering). No covering index is
 * missing for the < 5 s / 30x-scrub budget at v1 single-symbol scale —
 * see the perf note in the Task 1.7 report. The tick query orders by
 * `ts_ms` and is served by `ticks_symbol_ts_ms_idx` on `(symbol, ts_ms)`
 * plus partition pruning on the `ts_ms` partition key.
 *
 * **`delta` is projected, not stored.** `footprint_cells` dropped the
 * STORED generated `delta` column (ADR-005 / the table docblock); the
 * SELECT computes `(ask_volume - bid_volume) AS delta` so the replay row
 * carries it on the wire without the renderer recomputing it per row.
 */

/**
 * How many rows postgres-js pulls per cursor round-trip. A day's ~72K
 * cells / 500 = ~144 round-trips — small enough to keep latency low,
 * large enough that the per-round-trip overhead is amortised. Ticks use
 * a larger batch because a bounded window is far fewer rows than a full
 * day but each row is tiny.
 */
const CELL_CURSOR_BATCH = 500;
const TICK_CURSOR_BATCH = 1_000;

/**
 * **postgres-js returns `int8`/`bigint` columns as STRINGS over the raw
 * `sql` tagged-template path.** The Drizzle `mode: 'number'` on the table
 * declaration only applies through Drizzle's query builder — these replay
 * queries use the raw `sql` template (for the cursor streaming surface),
 * so `bucket_ts` / `price_bucket` / `ts_ms` (all `int8`) would arrive as
 * strings and fail the `z.number()` line schema. We cast them to `double
 * precision` IN SQL (`::double precision`) so the driver returns them as
 * JS `number`. The cast is lossless at our range: ms timestamps and
 * price-bucket indices stay far inside `Number.MAX_SAFE_INTEGER` (the
 * same int53-safety rationale the WS `tick.ts` / `cell.ts` schema
 * docblocks rely on). `double precision`, `int4`, and `text` columns
 * already decode to `number` / `string`, so after the casts each cursor
 * row matches the line type directly — `yield* batch` with no per-field
 * JS coercion. The Zod `parse` at the route boundary
 * (`replayCellRowSchema` / `replayTickRowSchema`) is the runtime guard
 * that still catches any driver-shape surprise before a line is shipped.
 */

/**
 * Stream the day's footprint cells, ordered by `(bucket_ts, price_bucket)`.
 *
 * Async generator — yields one `ReplayCellRow` at a time off the open
 * cursor. The caller (the route) serialises each to NDJSON. An
 * unknown-but-well-formed day with no persisted cells yields nothing (the
 * generator completes immediately) — the route streams an empty body.
 */
export async function* streamReplayCells(
  bounds: ReplayBounds,
): AsyncGenerator<ReplayCellRow, void, unknown> {
  const sql = getSql();
  const cursor = sql<ReplayCellRow[]>`
    SELECT
      symbol                            AS "symbol",
      bucket_ts::double precision       AS "bucketTs",
      price_bucket::double precision    AS "priceBucket",
      bid_volume                        AS "bidVolume",
      ask_volume                        AS "askVolume",
      trades                            AS "trades",
      (ask_volume - bid_volume)         AS "delta"
    FROM footprint_cells
    WHERE symbol = ${bounds.symbol}
      AND bucket_ts >= ${bounds.dayStartMs}
      AND bucket_ts <  ${bounds.dayEndMs}
    ORDER BY bucket_ts ASC, price_bucket ASC
  `.cursor(CELL_CURSOR_BATCH);

  for await (const batch of cursor) {
    // Pass-through: the SQL aliases produce camelCase columns and
    // postgres-js returns `double precision` / `bigint mode:number` /
    // `int4` as JS `number`, so each row already matches `ReplayCellRow`.
    yield* batch;
  }
}

/**
 * Stream the bounded raw-tick window for the tape strip, ordered by
 * `ts_ms`. `window` is already clamped to the day bounds by
 * `computeTickWindow` so this scan stays inside the pruned partition.
 *
 * The half-open interval `[fromMs, toMs)` matches the cell stream's
 * convention. `aggressor` is read straight from the persisted column
 * (already `'buy' | 'sell'` per ingest) — no `is_buyer_maker`
 * re-derivation.
 */
export async function* streamReplayTicks(
  bounds: ReplayBounds,
  window: TickWindow,
): AsyncGenerator<ReplayTickRow, void, unknown> {
  const sql = getSql();
  const cursor = sql<ReplayTickRow[]>`
    SELECT
      ts_ms::double precision   AS "tsMs",
      price                     AS "price",
      qty                       AS "qty",
      aggressor                 AS "aggressor"
    FROM ticks
    WHERE symbol = ${bounds.symbol}
      AND ts_ms >= ${window.fromMs}
      AND ts_ms <  ${window.toMs}
    ORDER BY ts_ms ASC
  `.cursor(TICK_CURSOR_BATCH);

  for await (const batch of cursor) {
    yield* batch;
  }
}
