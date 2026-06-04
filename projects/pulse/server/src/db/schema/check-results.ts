import { bigserial, index, integer, pgTable, smallint, timestamp, uuid } from 'drizzle-orm/pg-core';

import { checkErrorEnum, monitorStatusEnum } from './enums';
import { monitors } from './monitors';

/**
 * check_results — one row per probe occurrence (ADR-005). High-volume
 * time-series table (a 60 s monitor is ~1440 rows/day). Retained 35 days raw
 * (the GC sweep prunes older rows, ADR-005); the 7d/30d windows read the
 * hourly rollup instead.
 *
 * THE CRITICAL INDEX (ADR-005, AGENT_NOTES): `(monitor_id, checked_at DESC)`
 * — serves both the recent-checks read and the 24h uptime/window scan. This
 * is the hot read path; without it the board's per-card "recent checks" and
 * the on-the-fly 24h uptime become sequential scans.
 *
 * `status` / `error` use the shared enums. `error` is null when `up`; it is
 * the NORMALISED class (ADR-002), never a raw upstream message.
 *
 * A failing endpoint writes a `down` row here from a SUCCESSFUL BullMQ job
 * (ADR-002) — exactly one row per probe occurrence, idempotent against a
 * reclaimed-then-retried occurrence.
 */
export const checkResults = pgTable(
  'check_results',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: monitorStatusEnum('status').notNull(),
    statusCode: smallint('status_code'),
    responseTimeMs: integer('response_time_ms'),
    error: checkErrorEnum('error'),
  },
  (table) => [
    // The hot read path — DESC so "most recent first" is a forward index scan.
    index('check_results_monitor_checked_at_idx').on(table.monitorId, table.checkedAt.desc()),
  ],
);

export type CheckResultRow = typeof checkResults.$inferSelect;
export type NewCheckResultRow = typeof checkResults.$inferInsert;
