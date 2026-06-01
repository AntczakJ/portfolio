import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from './bytea';

/**
 * boards — one row per shared whiteboard URL.
 *
 * ADR-003 is canonical: this is the snapshot half of the hybrid ops-log +
 * debounced snapshot persistence shape. The Hocuspocus `Storage` adapter
 * (Task 1.3) writes `state` from `Y.encodeStateAsUpdate(doc)` on the
 * 5_000 ms / 30_000 ms / 100-ops trigger boundary and reads it back on
 * `onLoadDocument` as the cold-start fast path.
 *
 * Columns:
 *
 *  - `id`                  — `uuid` primary key, server-generated via
 *                            `defaultRandom()`. ADR-003 mentions a base32-12
 *                            text id; the Phase 1 Task 1.2 spec from the
 *                            canonical task brief pins
 *                            `uuid().defaultRandom()` so the v1 board id
 *                            surface is the Postgres native primitive.
 *                            The `POST /api/boards` route (Task 1.6)
 *                            returns the id verbatim; the URL slug in
 *                            the share affordance is the same uuid string.
 *                            If a future task wants a shorter share-URL
 *                            surface, it adds a distinct `slug` column
 *                            rather than reshaping `id`.
 *  - `name`                — display name slot. v1 anonymous boards get a
 *                            server-generated default like "Untitled board"
 *                            inside `POST /api/boards`; v2 lights up
 *                            user-editable titles without a schema bump.
 *  - `state`               — the snapshot `bytea` column. Nullable: a
 *                            brand-new board has no snapshot until the
 *                            first `onStoreDocument` flush completes. The
 *                            Storage adapter returns `null` to Hocuspocus
 *                            on `onLoadDocument` for a fresh board, which
 *                            signals "start with an empty Y.Doc" per the
 *                            framework contract.
 *  - `lastCompactedOpSeq`  — the highest `op_seq` already merged into the
 *                            snapshot held in `state`. The Storage
 *                            adapter (Task 1.3) sets this on every
 *                            `store(...)` call to the current `MAX(op_seq)`
 *                            for the board and, in the same transaction,
 *                            deletes `board_ops` rows with
 *                            `op_seq <= last_compacted_op_seq`. On
 *                            `fetch(...)` the adapter loads `state`,
 *                            applies it to a fresh `Y.Doc`, then replays
 *                            the surviving (`op_seq > last_compacted_op_seq`)
 *                            ops in order. ADR-003 names this column;
 *                            Task 1.2 deferred it, Task 1.3 adds it.
 *                            DEFAULT 0 because a freshly-created board
 *                            has no compacted history yet.
 *  - `createdAt`           — set once on insert. Surfaced in the welcome
 *                            frame per ADR-004 (`board.createdAt`).
 *  - `lastActiveAt`        — touched on every `onChange` so the 30-day
 *                            inactive-board retention sweep (ADR-003)
 *                            has a fresh signal. Index below makes the
 *                            retention SELECT a btree range scan, not a
 *                            sequential scan.
 *
 * Indexes:
 *
 *  - `boards_last_active_at_idx` on `last_active_at` — drives the nightly
 *    retention sweep `WHERE last_active_at < NOW() - INTERVAL '30 days'`.
 *
 * What's deliberately NOT here in Task 1.3:
 *
 *  - `superseded_at` on `board_ops` — Task 1.5 (compaction sweep) owns
 *    the marker column. Task 1.3 deletes compacted ops outright in the
 *    same transaction as the snapshot UPSERT, so v1 has no soft-delete
 *    state to reconcile. The `superseded_at` shape stays reserved for
 *    Task 1.5's hourly background compaction if it lands a soft-delete
 *    audit trail (deferred — Task 1.3 has no need for it).
 */
export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    state: bytea('state'),
    lastCompactedOpSeq: bigint('last_compacted_op_seq', { mode: 'number' })
      .notNull()
      .default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('boards_last_active_at_idx').on(table.lastActiveAt),
  ],
);

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
