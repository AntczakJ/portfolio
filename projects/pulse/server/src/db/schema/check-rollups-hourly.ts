import { integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { monitors } from './monitors';

/**
 * check_rollups_hourly — pre-aggregated hourly buckets (ADR-004 / ADR-005).
 *
 * Serves the 7d/30d uptime computation and the long-window response-time
 * chart so those reads touch ~168 / ~720 rows instead of tens of thousands of
 * raw rows. Populated by a BullMQ repeatable ROLLUP job (every 5 min,
 * idempotent upsert on the PK) — that job is Phase 2; this table is its sink.
 *
 * Retained 400 days (cheap — 24 rows/day/monitor). PK `(monitor_id,
 * bucket_start)` makes the upsert idempotent and the long-window scan a
 * range scan on the leading PK column.
 */
export const checkRollupsHourly = pgTable(
  'check_rollups_hourly',
  {
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    bucketStart: timestamp('bucket_start', { withTimezone: true, mode: 'date' }).notNull(),
    upCount: integer('up_count').notNull().default(0),
    degradedCount: integer('degraded_count').notNull().default(0),
    downCount: integer('down_count').notNull().default(0),
    unknownCount: integer('unknown_count').notNull().default(0),
    avgResponseTimeMs: integer('avg_response_time_ms'),
    p95ResponseTimeMs: integer('p95_response_time_ms'),
    minMs: integer('min_ms'),
    maxMs: integer('max_ms'),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.bucketStart] })],
);

export type CheckRollupHourly = typeof checkRollupsHourly.$inferSelect;
export type NewCheckRollupHourly = typeof checkRollupsHourly.$inferInsert;
