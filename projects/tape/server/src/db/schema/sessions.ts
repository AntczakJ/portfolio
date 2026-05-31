import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * sessions — continuous market sessions captured from a streaming source.
 *
 * A session represents a single uninterrupted window of market data on a
 * given symbol from a given upstream source. Ingestion (Task 1.3) opens
 * a session row when the Binance WebSocket connects and stamps `ended_at`
 * when the stream cleanly disconnects; replay queries (Task 1.7) carve
 * footprint cell data along session boundaries.
 *
 * Intentionally minimal in Phase 1. The trade-level table (Task 1.3) and
 * footprint cell tables (Tasks 1.5 / 1.6) live in sibling files. Do not
 * pre-design those columns here.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  symbol: text('symbol').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
  source: text('source').notNull().default('binance-futures'),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
