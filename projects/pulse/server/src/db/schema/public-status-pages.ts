import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { monitors } from './monitors';
import { users } from './users';

/**
 * public_status_pages — an unauthenticated status surface (ADR-005).
 *
 * v1 ships one page, but the join table below keeps the public monitor set
 * explicit and v2-ready (multiple pages, custom slugs). The public stream
 * (ADR-003) and public read endpoints resolve a page's monitor set through
 * the join.
 */
export const publicStatusPages = pgTable('public_status_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type PublicStatusPage = typeof publicStatusPages.$inferSelect;
export type NewPublicStatusPage = typeof publicStatusPages.$inferInsert;

/**
 * public_status_page_monitors — which monitors appear on which page. PK on
 * both columns (a monitor appears at most once per page). The public surface
 * exposes ONLY monitors present here, so the auth boundary (public sees only
 * what is explicitly published) is data-enforced.
 */
export const publicStatusPageMonitors = pgTable(
  'public_status_page_monitors',
  {
    statusPageId: uuid('status_page_id')
      .notNull()
      .references(() => publicStatusPages.id, { onDelete: 'cascade' }),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.statusPageId, table.monitorId] })],
);

export type PublicStatusPageMonitor = typeof publicStatusPageMonitors.$inferSelect;
export type NewPublicStatusPageMonitor = typeof publicStatusPageMonitors.$inferInsert;
