-- ============================================================================
-- MIGRATION 0001 — TICKS PARTITIONING BOOTSTRAP + FOOTPRINT_CELLS TABLE
--
-- ATTENTION FUTURE EDITORS / CODE REVIEWERS:
--
--   This migration has been HAND-EDITED on top of `drizzle-kit generate`'s
--   output to apply Postgres native declarative partitioning to the `ticks`
--   table. ADR-005 is canonical for the reasoning; the short version:
--
--     - `ticks` is partitioned by month on `ts_ms` (`PARTITION BY RANGE
--       (ts_ms)`). The Drizzle DSL does NOT express partitioning, so the
--       schema file (`src/db/schema/ticks.ts`) declares the columns and
--       PK, and this SQL adds the partition clause.
--     - The PK on `ticks` is `(ts_ms, session_id, symbol)` — Postgres
--       requires the partition key to be part of every unique constraint
--       on the parent. See `ticks.ts` docblock for the column-choice
--       rationale.
--     - The initial partitions cover the current month (2026-05) and the
--       next month (2026-06). Subsequent months are created by the
--       rolling partition scheduler in `src/db/partitions.ts`
--       (`ensureRollingPartitions`), called from the daily 03:00 UTC
--       sweep in Task 1.2b.
--     - `footprint_cells` is NOT partitioned per ADR-005 (cell volume is
--       below the partition-management break-even at v1 single-symbol
--       scale).
--
--   ONE-WAY MIGRATION POLICY. drizzle-kit cannot round-trip partitioning
--   — its declarative-state diff sees `pgTable('ticks', ...)` as a plain
--   table and would emit a `DROP TABLE ticks; CREATE TABLE ticks ...`
--   pair to "fix" the divergence if it were not already applied. Two
--   defences prevent that drift:
--
--     1. `drizzle-kit generate` is idempotent against the recorded
--        snapshot in `meta/0001_snapshot.json`. As long as the schema
--        files do not change column shape or PK, re-running generate
--        produces NO new migration (verified at task completion).
--     2. If you ever change the `ticks` table's column shape, generate
--        the new migration normally and then HAND-EDIT it: the diff is
--        applied to the parent table; partitions inherit columns
--        automatically (Postgres native partitioning rule). Do not let
--        drizzle-kit regenerate this 0001 migration.
--
--   Date-math used for the partition boundaries (recomputable by hand):
--     2026-05-01T00:00:00Z  = Date.UTC(2026, 4, 1)  = 1777593600000 ms
--     2026-06-01T00:00:00Z  = Date.UTC(2026, 5, 1)  = 1780272000000 ms
--     2026-07-01T00:00:00Z  = Date.UTC(2026, 6, 1)  = 1782864000000 ms
--   (The `partitionForMonth` helper in `src/db/partitions.ts` computes
--    these from `Date.UTC` directly — same constants, same boundaries.)
-- ============================================================================

CREATE TABLE "footprint_cells" (
	"symbol" text NOT NULL,
	"bucket_ts" bigint NOT NULL,
	"price_bucket" bigint NOT NULL,
	"bid_volume" double precision DEFAULT 0 NOT NULL,
	"ask_volume" double precision DEFAULT 0 NOT NULL,
	"trades" integer DEFAULT 0 NOT NULL,
	"session_id" uuid NOT NULL,
	CONSTRAINT "footprint_cells_pk" PRIMARY KEY("symbol","bucket_ts","price_bucket")
);
--> statement-breakpoint
CREATE TABLE "ticks" (
	"ts_ms" bigint NOT NULL,
	"symbol" text NOT NULL,
	"price" double precision NOT NULL,
	"qty" double precision NOT NULL,
	"aggressor" text NOT NULL,
	"session_id" uuid NOT NULL,
	CONSTRAINT "ticks_pk" PRIMARY KEY("ts_ms","session_id","symbol")
) PARTITION BY RANGE ("ts_ms");
--> statement-breakpoint
-- Initial monthly partitions for the current month + next month. Subsequent
-- months are pre-created by `ensureRollingPartitions` from
-- `src/db/partitions.ts`, called from the daily 03:00 UTC sweep that
-- Task 1.2b wires into Elysia's boot path.
CREATE TABLE "ticks_y2026m05" PARTITION OF "ticks"
	FOR VALUES FROM (1777593600000) TO (1780272000000);
--> statement-breakpoint
CREATE TABLE "ticks_y2026m06" PARTITION OF "ticks"
	FOR VALUES FROM (1780272000000) TO (1782864000000);
--> statement-breakpoint
ALTER TABLE "footprint_cells" ADD CONSTRAINT "footprint_cells_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticks" ADD CONSTRAINT "ticks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "footprint_cells_symbol_bucket_ts_idx" ON "footprint_cells" USING btree ("symbol","bucket_ts");--> statement-breakpoint
CREATE INDEX "footprint_cells_session_bucket_ts_idx" ON "footprint_cells" USING btree ("session_id","bucket_ts");--> statement-breakpoint
CREATE INDEX "ticks_symbol_ts_ms_idx" ON "ticks" USING btree ("symbol","ts_ms");
