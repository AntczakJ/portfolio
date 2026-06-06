import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { SimEvent } from 'atlas-shared/schemas';

import { vehicles } from './vehicles';
import { zones } from './zones';
import { eventTypeEnum } from './enums';

/**
 * events — the events feed + a bounded history (ADR-005). Geofence enter/exit,
 * status changes, arrived/departed. A capped rolling window (the retention
 * sweep prunes beyond N / a time window, Task 3.3) — NOT a long-horizon log.
 *
 * THE FEED INDEXES (ADR-005):
 *   - `(at DESC)`              — the global "latest events" feed read.
 *   - `(vehicle_id, at DESC)`  — the per-vehicle recent-events read (detail panel).
 *
 * `payload` is the shared `SimEvent['payload']` (the per-type feed context) in
 * `jsonb`. `zone_id` is denormalised to a column (nullable) for the zone-filtered
 * read; it is null for non-geofence events. `id` is a string mirroring the
 * shared `SimEvent.id`; a bigserial `seq` gives a stable monotonic order even
 * when two events share an `at` timestamp.
 */
export const events = pgTable(
  'events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: text('id').notNull().unique(),
    type: eventTypeEnum('type').notNull(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    zoneId: text('zone_id').references(() => zones.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull(),
    payload: jsonb('payload').$type<SimEvent['payload']>().notNull(),
  },
  (table) => [
    index('events_at_idx').on(table.at.desc()),
    index('events_vehicle_id_at_idx').on(table.vehicleId, table.at.desc()),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
