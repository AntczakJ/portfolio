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
 * The row TS types continue to come from Drizzle's `$inferSelect` /
 * `$inferInsert` re-exports (`Tick` / `NewTick`). Going through
 * Drizzle's inferred types — rather than `z.output<typeof schema>` —
 * avoids a Zod 3 vs Zod 4 generic-bound friction in this monorepo:
 * `tape-server` is on Zod 3 (Elysia 1.4.x's pinned major) and
 * `drizzle-zod` 0.8 emits Zod 4 schemas. The schemas themselves work at
 * runtime against either zod; only the static `z.output` constraint
 * mismatch surfaced as a tsc error. Drizzle's inferred types are the
 * canonical row contract in this codebase anyway (per Task 1.2
 * AGENT_NOTES on the drizzle-zod boundary policy).
 */
export const tickSelectSchema = createSelectSchema(ticks);
export const tickInsertSchema = createInsertSchema(ticks);

export type TickRow = Tick;
export type TickInsert = NewTick;
