/**
 * Drizzle schema barrel.
 *
 * One table per file keeps `drizzle-kit generate` diffs surgical.
 *
 * Phase 1 Task 1.2 tables per ADR-003 (hybrid ops-log + debounced snapshot):
 *   - `boards`      — snapshot bytea + metadata (1 row per shared URL).
 *   - `board_ops`   — durable per-edit ops log (cascades on board delete).
 *
 * `bytea` is the shared `customType` helper used by both tables; not a
 * table itself, so it's not re-exported here. Importers go direct.
 *
 * Future tasks land sibling files (no churn here):
 *   - Task 1.5 — `superseded_at` marker on `board_ops` for the compaction
 *                sweep, denormalised `snapshot_seq` + `updated_at` on
 *                `boards`. Both are column additions (not new files).
 *   - Task 1.7 — better-auth scaffolded but inactive. Auth tables (users,
 *                sessions, accounts) land as separate files when the
 *                scaffold ships, kept distinct from the board tables.
 */
export * from './boards';
export * from './board-ops';
