import { pgTable, smallint, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { alertChannels } from './alert-channels';
import { alertDeliveryStatusEnum, alertTransitionEnum } from './enums';
import { incidents } from './incidents';

/**
 * alert_deliveries — one row per alert sent for an incident transition
 * (ADR-005).
 *
 * THE DE-DUP INVARIANT PUSHED TO THE DB (ADR-005, AGENT_NOTES): a UNIQUE
 * `(incident_id, alert_channel_id, transition)` guarantees one delivery per
 * (incident, channel, transition). Even if the alerts module fired twice
 * (retry, race), the second insert violates the constraint, so a recruiter
 * never sees a duplicate alert. This is the "one alert per incident
 * transition" rule made un-violable.
 */
export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    alertChannelId: uuid('alert_channel_id')
      .notNull()
      .references(() => alertChannels.id, { onDelete: 'cascade' }),
    transition: alertTransitionEnum('transition').notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    status: alertDeliveryStatusEnum('status').notNull(),
    responseCode: smallint('response_code'),
  },
  (table) => [
    uniqueIndex('alert_deliveries_dedup_idx').on(
      table.incidentId,
      table.alertChannelId,
      table.transition,
    ),
  ],
);

export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type NewAlertDelivery = typeof alertDeliveries.$inferInsert;
