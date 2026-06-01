import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

import { boards } from '../../../db/schema/boards';

/**
 * Zod schemas for `boards` derived from the Drizzle table.
 *
 * Pulled out via `drizzle-zod` so the Zod shape is a strict function of
 * the schema file — adding a column to `db/schema/boards.ts` updates
 * these schemas in one regen, not two. Per docs/conventions.md § 5, Zod
 * schemas in `src/lib/schemas/` are the integration boundary; this file
 * is the boundary for the `boards` row shape specifically.
 *
 * `bytea` columns surface as `z.instanceof(Uint8Array)` through
 * `drizzle-zod`'s `customType` handling — the Storage adapter (Task 1.3)
 * threads `Uint8Array` end-to-end without a manual coercion.
 *
 * Insert vs select split:
 *
 *  - `boardSelectSchema` — the on-the-wire row shape. Used by the load
 *    path validation (`fetch(documentName)` in the Storage adapter) and
 *    by any HTTP route that returns a board row.
 *  - `boardInsertSchema` — the persistence-layer insert shape. Server-
 *    generated columns (`id` via `defaultRandom()`, `createdAt`,
 *    `lastActiveAt`) are optional on insert; the `name` column is
 *    required. The Storage adapter's `store` path UPSERTs against this
 *    shape; the `POST /api/boards` route (Task 1.6) inserts a fresh row
 *    against it.
 *
 * Inferred TypeScript types are NOT re-exported from this file — call
 * sites import `Board` / `NewBoard` directly from
 * `src/db/schema/boards.ts` (the `$inferSelect` / `$inferInsert` shapes
 * are the runtime-validated types). This keeps one source of truth per
 * row shape and avoids the "is `Board` the Drizzle type or the Zod
 * type?" ambiguity at the call site.
 */
export const boardSelectSchema = createSelectSchema(boards);
export const boardInsertSchema = createInsertSchema(boards);
