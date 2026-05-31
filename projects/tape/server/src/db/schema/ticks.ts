import { bigint, doublePrecision, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { sessions } from './sessions';

/**
 * ticks — raw aggTrade archive, the durable source of truth for replay.
 *
 * ADR-005 is canonical for this table. Two non-obvious things every reader
 * of this file should know up front:
 *
 *  1. **Drizzle DSL does NOT express native Postgres declarative
 *     partitioning.** This `pgTable` declaration is the type contract; the
 *     actual `CREATE TABLE ... PARTITION BY RANGE (ts_ms)` clause and the
 *     initial month partitions live in the hand-edited migration SQL at
 *     `drizzle/0001_*.sql`. The schema file is the TS truth; the migration
 *     is the SQL truth. If you regenerate the migration with `db:generate`
 *     and the diff comes back non-empty, drizzle-kit has tried to "fix"
 *     the partitioned table back to a plain table — STOP and consult the
 *     migration's own header before committing.
 *
 *  2. **The primary key MUST include the partition column.** Postgres
 *     requires every unique constraint on a partitioned table to include
 *     the partition key. We chose `(ts_ms, session_id, symbol)`:
 *       - `ts_ms` is the partition column (mandatory) AND the natural
 *         sort key for the replay scan path (`WHERE ts_ms BETWEEN
 *         <day_start> AND <day_end> ORDER BY ts_ms`).
 *       - `session_id` distinguishes simultaneous sessions that happen to
 *         tag the same millisecond — a session-restart edge case where
 *         the new generation can land within the same ms as the trailing
 *         tick of the previous generation.
 *       - `symbol` keeps the PK uniqueness-meaningful in the v2 multi-
 *         symbol world without a schema bump (PLAN.md "Out of scope (v1)"
 *         pivots to ETH-PERP and SOL-PERP); v1 has one symbol so the
 *         column degenerates to a constant but the PK shape stays stable.
 *     This PK is intentionally NOT a synthetic surrogate — Binance does
 *     emit a monotonic `aggTradeId` per stream but ADR-005 deliberately
 *     omits it from the ingest column set (the parent task spec restricted
 *     the row shape), so we let the natural composite carry uniqueness.
 *
 * Read path: the `(symbol, ts_ms)` btree index serves the per-symbol
 * sliding window the replay engine scans around the cursor. The composite
 * PK supports `WHERE ts_ms BETWEEN ...` directly as a range scan via
 * partition pruning + the PK's leading column.
 *
 * Retention: 30 days raw (ADR-005). The drop happens via O(1)
 * `DROP TABLE ticks_yYYYYmMM` from `dropTickPartitionsOlderThan` in
 * `src/db/partitions.ts`, NOT via `DELETE FROM ticks WHERE ts_ms < ...`
 * which would force a table rewrite.
 *
 * Bigint mode = number: Drizzle's `bigint(..., { mode: 'number' })` returns
 * the column as a JS `number`. Postgres `int8` carries the full 2^63 range
 * but millisecond timestamps in our lifetime stay below
 * `Number.MAX_SAFE_INTEGER` (2^53), so a number is safe and avoids the
 * `BigInt` ergonomic tax on the hot path. If we ever store something in
 * an int8 column that genuinely needs the full int8 range (e.g. a Binance
 * trade id), switch THAT column to `mode: 'bigint'` — leave `ts_ms` alone.
 */
export const ticks = pgTable(
  'ticks',
  {
    /**
     * Trade timestamp in milliseconds (Binance's `T` field on aggTrade).
     * The partition key. Storing as `int8` rather than `timestamptz` keeps
     * the wire format identical to the WS frame (`tsMs: number` per
     * ADR-006) and avoids a per-row tz conversion on insert.
     */
    tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
    symbol: text('symbol').notNull(),
    /**
     * f64 on the wire and on disk. The chart renders to integer pixels;
     * Binance reports BTC-PERP prices with at most 2 decimal places so an
     * f64 mantissa has 9+ orders of magnitude of headroom. ADR-005 named
     * `numeric(20,8)` as a strict-precision option but the parent task
     * spec pinned `doublePrecision` for both ingest hot-path cost and WS
     * frame parity — documented here so the reviewer does not file
     * "should be numeric" on next pass.
     */
    price: doublePrecision('price').notNull(),
    qty: doublePrecision('qty').notNull(),
    /**
     * Aggressor side. Postgres-native ENUM types are a maintenance tax
     * (every value addition needs a migration and an `ALTER TYPE`), and a
     * CHECK constraint adds parser overhead on every `COPY` insert. We
     * use `text` with Drizzle's compile-time `enum: [...]` narrowing — the
     * column accepts arbitrary text at the DB level but every TS call
     * site sees the literal union `'buy' | 'sell'`. Pairs cleanly with
     * `COPY ticks FROM STDIN` in Task 1.2b: the COPY path streams plain
     * bytes, a CHECK constraint would cost ~1 µs per row. Application-
     * level Zod validation at ingest is the boundary that keeps the
     * column honest.
     */
    aggressor: text('aggressor', { enum: ['buy', 'sell'] }).notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({
      // See the file-level docblock for the rationale on each column.
      columns: [table.tsMs, table.sessionId, table.symbol],
      name: 'ticks_pk',
    }),
    // Replay scan: `WHERE symbol = $1 AND ts_ms BETWEEN $2 AND $3`. The
    // partition pruner already narrows on `ts_ms`; this index narrows on
    // `symbol` within the pruned partition.
    index('ticks_symbol_ts_ms_idx').on(table.symbol, table.tsMs),
  ],
);

export type Tick = typeof ticks.$inferSelect;
export type NewTick = typeof ticks.$inferInsert;
