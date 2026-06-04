import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * users — the better-auth `user` model, mapped onto our existing `users`
 * table (ADR-005 / ADR-007, Phase 6).
 *
 * RECONCILIATION (the Phase-1 flag resolved): the Phase-1 `users` stub used a
 * `uuid` PK so the FK columns (`monitors.user_id`, `alert_channels.user_id`,
 * `public_status_pages.user_id`, cascade delete) could be satisfied before auth
 * landed. better-auth's DEFAULT user id is a TEXT id — adopting its schema
 * wholesale would have forced repointing every `uuid` FK to `text` in a
 * migration. We avoid that entirely: the auth instance is configured with a
 * UUID id generator (`advanced.database.generateId`, see `src/auth/auth.ts`)
 * and its `user` model is mapped onto THIS table (`user: { modelName: 'users' }`),
 * so the id stays `uuid` and EVERY existing FK keeps working untouched. The
 * Phase-6 migration only ADDS the columns better-auth needs on top of the stub
 * (`email_verified`, `image`, `updated_at`) — it never repoints an FK.
 *
 * better-auth writes to this table through its Drizzle adapter; the rest of the
 * app reads it through the same Drizzle handle. Owner resolution
 * (`resolveOwnerUserId` / the auth guard) returns `users.id` exactly as before.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // better-auth `user` fields. `name` was nullable in the Phase-1 stub; the
  // sign-up flow always provides it, but it stays nullable so the seeded demo
  // owner (created by the dev-owner seam before auth existed) remains valid.
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
