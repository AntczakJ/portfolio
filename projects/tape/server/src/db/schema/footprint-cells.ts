import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { sessions } from './sessions';

/**
 * footprint_cells — persisted close-time totals for each footprint cell.
 *
 * ADR-005 § "Cell-store options" pins this as **option 6**: a single,
 * unpartitioned table written through by the Rust worker on bar-close
 * (one transaction per closed 1-min bar, ~50 rows per transaction,
 * ~1 tx/min per symbol). Year-1 worst case ≈ 26 M rows on single-symbol
 * BTC-PERP — well below the ~50 M-row partition-management break-even.
 *
 * Why this table is NOT partitioned (when `ticks` is):
 *
 *  - Cell writes are bar-aligned, low-frequency, and small (~50 rows/min
 *    vs ticks at 100–200 rows/sec). The buffer-pool churn that drove the
 *    partition decision for `ticks` does not exist here.
 *  - Cells are kept indefinitely per ADR-004's "closed-bar history is the
 *    durable source of truth on recovery" invariant. There is no
 *    retention drop to optimise.
 *  - Partitioning would add per-query planner cost and per-month
 *    maintenance code for a table that does not pay it back until ~year-2
 *    multi-symbol scale (PLAN.md "Out of scope (v1)" pivot to ETH-PERP +
 *    SOL-PERP triples the row count and is the right re-evaluation
 *    trigger).
 *
 * The primary key is the natural identity of a footprint cell:
 * `(symbol, bucket_ts, price_bucket)`. One row per cell per bar. No
 * UPSERT churn — the worker writes each bar exactly once at bar close.
 *
 * Numeric types:
 *  - `bucket_ts`: bar start in milliseconds (int8, `mode: 'number'`).
 *    Stored as ms not `timestamptz` so the WS frame (`bucketTs: number`
 *    per ADR-006) and the persisted row use the same units — no per-row
 *    tz conversion at write or read.
 *  - `price_bucket`: bucketed price id (int8, `mode: 'number'`). Cells
 *    are aligned to a per-symbol step (BTC-PERP defaults to $5 in v1);
 *    the `price_bucket` is the integer step index. Storing the bucket id
 *    rather than the bucketed price keeps the PK trivially numeric and
 *    avoids a `numeric(20,2)` floating-point identity hazard.
 *  - `bid_volume` / `ask_volume`: f64. Same rationale as `ticks.price` —
 *    chart renders to pixels, BTC-PERP volumes fit comfortably in f64
 *    mantissa.
 *  - `trades`: int4. Per-cell trade count, bounded well below i32.
 *
 * Note on the `delta` column. ADR-005 originally specified a
 * `GENERATED ALWAYS AS (ask_volume - bid_volume) STORED` column. The
 * parent Task 1.2a spec dropped it from the row shape — the derived value
 * stays on the WS frame side (`cell.close.delta`) where the worker
 * computes it once at bar close and pushes it on the wire. The
 * round-trip via DB write + read + compute is cheaper than a STORED
 * generated column at our scale because the reader (replay endpoint)
 * already projects `(ask_volume - bid_volume) AS delta` in the SELECT —
 * one subtraction per replayed row is invisible against the network
 * cost. If a future replay query path proves CPU-bound on this
 * subtraction, the migration to add `delta GENERATED ALWAYS AS ... STORED`
 * is one statement; it does not gate v1.
 */
export const footprintCells = pgTable(
  'footprint_cells',
  {
    symbol: text('symbol').notNull(),
    bucketTs: bigint('bucket_ts', { mode: 'number' }).notNull(),
    priceBucket: bigint('price_bucket', { mode: 'number' }).notNull(),
    bidVolume: doublePrecision('bid_volume').notNull().default(0),
    askVolume: doublePrecision('ask_volume').notNull().default(0),
    trades: integer('trades').notNull().default(0),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({
      columns: [table.symbol, table.bucketTs, table.priceBucket],
      name: 'footprint_cells_pk',
    }),
    // Replay scan: stream all cells for a given symbol within a UTC day,
    // ordered by `bucket_ts` then `price_bucket`. The PK's leading column
    // (symbol) already supports `WHERE symbol = $1`; this index narrows
    // further by `bucket_ts` for the day-range scan.
    index('footprint_cells_symbol_bucket_ts_idx').on(table.symbol, table.bucketTs),
    // Per-session queries (debug / per-session replay isolation in v2).
    index('footprint_cells_session_bucket_ts_idx').on(table.sessionId, table.bucketTs),
  ],
);

export type FootprintCell = typeof footprintCells.$inferSelect;
export type NewFootprintCell = typeof footprintCells.$inferInsert;
