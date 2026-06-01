import {
  bigserial,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { boards } from './boards';
import { bytea } from './bytea';

/**
 * board_ops — durable per-edit ops log.
 *
 * The ops half of the ADR-003 hybrid persistence shape. Every Yjs
 * sync-update payload the Hocuspocus `onChange` hook receives (Task 1.3)
 * is appended here BEFORE the framework's snapshot debounce fires. This
 * is what pins the crash-recovery loss bound at sub-second fsync: each
 * op commits on receipt, so the snapshot debounce affects only the
 * cold-start fast path, not durability.
 *
 * Columns:
 *
 *  - `id`         — `bigserial` surrogate primary key. Postgres assigns
 *                   a globally-monotonic id across all boards; we keep
 *                   this for the cascade-delete + the
 *                   `ORDER BY id` fallback on equal `op_seq` (paranoia).
 *                   The load-bearing natural key is `(board_id, op_seq)`
 *                   — see the unique index below.
 *  - `boardId`    — `uuid` FK to `boards.id`, `ON DELETE CASCADE`. The
 *                   nightly retention sweep (ADR-003 / Task 1.5)
 *                   `DELETE FROM boards WHERE last_active_at < ...` and
 *                   the cascade removes the associated ops in the same
 *                   transaction; no separate ops cleanup pass needed.
 *  - `opSeq`      — per-board monotonic counter assigned by the Storage
 *                   adapter (Task 1.3). Seeded on adapter boot from
 *                   `SELECT MAX(op_seq) FROM board_ops WHERE board_id = X`.
 *                   Per-board monotonic — NOT a global serial — because
 *                   the load-bearing property is `WHERE op_seq <=
 *                   LAST_COMPACTED ORDER BY op_seq` per board, not a
 *                   global ordering. Multi-instance deployment turns
 *                   this into a shared-state hazard; v1 single-instance
 *                   Node deployment is fine. Pinned in AGENT_NOTES.md.
 *  - `update`     — the binary `Y.UpdateMessage` payload from Hocuspocus.
 *                   Stored as `bytea` (NOT JSON) per the AGENT_NOTES.md
 *                   pin — Yjs's compact wire format is the whole point.
 *  - `createdAt`  — wall-clock for debugging / observability. NOT used
 *                   by the replay path; replay sorts by `op_seq`.
 *
 * Indexes:
 *
 *  - `board_ops_board_id_op_seq_unique` — UNIQUE composite on
 *    `(board_id, op_seq)`. Two jobs:
 *      1. Enforces per-board monotonic uniqueness — a concurrent writer
 *         bug that double-inserts at the same `op_seq` fails loudly at
 *         the DB rather than silently producing a torn replay.
 *      2. Backs the hot-path replay SELECT
 *         `WHERE board_id = $1 AND op_seq > $2 ORDER BY op_seq`. The
 *         leading column narrows to the board's partition of the index;
 *         the trailing column drives the order-by directly.
 *
 * What's deliberately NOT here in Task 1.2:
 *
 *  - `superseded_at timestamptz` — ADR-003 names this for the compaction
 *    sweep (Task 1.5). The unique index above is the v1 ceiling; Task 1.5
 *    adds the marker column AND a partial index
 *    `(board_id, op_seq) WHERE superseded_at IS NULL` to keep the hot
 *    replay SELECT tight as compaction history accumulates.
 */
export const boardOps = pgTable(
  'board_ops',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    opSeq: integer('op_seq').notNull(),
    update: bytea('update').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('board_ops_board_id_op_seq_unique').on(
      table.boardId,
      table.opSeq,
    ),
    // Plain composite index reserved for the replay scan path; the unique
    // index above already serves it, but a sibling non-unique index is
    // cheap insurance against a future refactor that drops uniqueness
    // (e.g. multi-instance deployment that loses per-board monotonicity).
    index('board_ops_board_id_op_seq_idx').on(table.boardId, table.opSeq),
  ],
);

export type BoardOp = typeof boardOps.$inferSelect;
export type NewBoardOp = typeof boardOps.$inferInsert;
