import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

import { ticks } from '../../../db/schema/ticks';
import type { NewTick, Tick } from '../../../db/schema/ticks';

/**
 * Zod schemas for the `ticks` row. Derived from the Drizzle table so the
 * column list is mechanically kept in sync — adding a column to
 * `src/db/schema/ticks.ts` propagates here without a second edit.
 *
 * `tickSelectSchema` matches a row read from the DB (post-defaults, all
 * NOT NULL columns present).
 * `tickInsertSchema` matches a row about to be inserted (NOT NULL columns
 * required, defaults optional).
 *
 * The row TS types come from Drizzle's `$inferSelect` / `$inferInsert`
 * re-exports (`Tick` / `NewTick`) rather than `z.output<typeof schema>`.
 * `tape-server` and `drizzle-zod` 0.8 are both on Zod 4 now, so the old
 * Zod 3 vs Zod 4 generic-bound friction (a `z.output` constraint
 * mismatch that surfaced as a tsc error) is gone — but Drizzle's
 * inferred types remain the canonical row contract in this codebase
 * regardless (per Task 1.2 AGENT_NOTES on the drizzle-zod boundary
 * policy), so we keep sourcing the row types from Drizzle.
 */
export const tickSelectSchema = createSelectSchema(ticks);
export const tickInsertSchema = createInsertSchema(ticks);

export type TickRow = Tick;
export type TickInsert = NewTick;
