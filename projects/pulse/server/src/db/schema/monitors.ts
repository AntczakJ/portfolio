import { boolean, index, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { monitorMethodEnum, monitorStatusEnum } from './enums';
import { users } from './users';

/**
 * monitors — one row per endpoint being watched (ADR-005).
 *
 * The scheduler keys a repeatable BullMQ job off `id` (stable scheduler id
 * `probe:<id>`, ADR-002) with `every = interval_seconds * 1000`. The job
 * payload is only `{ monitorId }`; the worker re-reads this row at run time
 * so an edit to (e.g.) `timeout_ms` takes effect on the next run without
 * re-touching the queue.
 *
 * Columns follow the ADR-005 ratified set. `failure_threshold` /
 * `recovery_threshold` (default 3 / 2) feed the incident state machine
 * (ADR-004); `degraded_threshold_ms` is the slow-but-up boundary (ADR-002).
 */
export const monitors = pgTable(
  'monitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetUrl: text('target_url').notNull(),
    method: monitorMethodEnum('method').notNull().default('GET'),
    intervalSeconds: integer('interval_seconds').notNull().default(60),
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
    expectedStatus: smallint('expected_status').notNull().default(200),
    expectedKeyword: text('expected_keyword'),
    degradedThresholdMs: integer('degraded_threshold_ms').notNull().default(1_000),
    failureThreshold: smallint('failure_threshold').notNull().default(3),
    recoveryThreshold: smallint('recovery_threshold').notNull().default(2),
    isPublic: boolean('is_public').notNull().default(false),
    isPaused: boolean('is_paused').notNull().default(false),
    // Derived live status + last-probe timestamp (Phase 2.2). `current_status`
    // is NULL until the monitor's first probe records a result — NULL reads as
    // `unknown` on the board (the ADR-004 unknown/idle state), which keeps the
    // strict `up|degraded|down` enum for actual check outcomes. The probe
    // recorder updates both on every check and detects a status transition.
    currentStatus: monitorStatusEnum('current_status'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('monitors_user_id_idx').on(table.userId)],
);

export type Monitor = typeof monitors.$inferSelect;
export type NewMonitor = typeof monitors.$inferInsert;
