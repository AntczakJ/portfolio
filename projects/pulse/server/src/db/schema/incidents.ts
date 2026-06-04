import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { incidentSeverityEnum, incidentStatusEnum } from './enums';
import { monitors } from './monitors';

/**
 * incidents — one row per outage (ADR-004 / ADR-005).
 *
 * THE CORRECTNESS INVARIANT PUSHED TO THE DB (ADR-005, AGENT_NOTES): a PARTIAL
 * UNIQUE index `(monitor_id) WHERE status = 'open'` enforces single-open-
 * incident-per-monitor at the database, not just in app code. Even if the
 * incident reducer had a bug, Postgres rejects a second concurrent open
 * incident for the same monitor. This is the "single-incident-per-outage"
 * invariant from ADR-004 made un-violable.
 *
 * `severity` may escalate `degraded -> down` on the open incident; it never
 * opens a second incident. `cause` is a text snapshot of the failing
 * condition. `(monitor_id, started_at DESC)` indexes the history list.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    status: incidentStatusEnum('status').notNull().default('open'),
    severity: incidentSeverityEnum('severity').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    cause: text('cause').notNull(),
  },
  (table) => [
    // Single-open-incident-per-monitor — enforced at the DB via a partial
    // unique index. Drizzle emits `CREATE UNIQUE INDEX ... WHERE status='open'`.
    uniqueIndex('incidents_one_open_per_monitor_idx')
      .on(table.monitorId)
      .where(sql`${table.status} = 'open'`),
    index('incidents_monitor_started_at_idx').on(table.monitorId, table.startedAt.desc()),
  ],
);

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
