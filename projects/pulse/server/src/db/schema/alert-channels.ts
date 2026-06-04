import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { alertChannelTypeEnum } from './enums';
import { users } from './users';

/**
 * alert_channels — a delivery target for incident alerts (ADR-005).
 *
 * `type` is `webhook` (REAL — HMAC-signed outbound, ADR-005) or `email`
 * (MOCKED in v1 — records a delivery row + logs, no SMTP). `secret` is the
 * per-channel HMAC signing key for webhook payloads; nullable for email. The
 * `secret` is NEVER returned over the API (see the response schema).
 */
export const alertChannels = pgTable('alert_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: alertChannelTypeEnum('type').notNull(),
  target: text('target').notNull(),
  secret: text('secret'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type AlertChannel = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;
