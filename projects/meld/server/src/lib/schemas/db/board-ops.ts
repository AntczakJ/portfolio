import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

import { boardOps } from '../../../db/schema/board-ops';

/**
 * Zod schemas for `board_ops` derived from the Drizzle table.
 *
 * Same rationale as `boards.ts` in this folder — pulled via `drizzle-zod`
 * so the Zod shape stays a strict function of the schema file. Per
 * docs/conventions.md § 5, Zod schemas in `src/lib/schemas/` are the
 * integration boundary; this file is the boundary for the `board_ops`
 * row shape specifically.
 *
 * `bytea` (the `update` column) surfaces as `z.instanceof(Uint8Array)`
 * via the `customType` handler — the Storage adapter (Task 1.3) threads
 * the Yjs binary update payload end-to-end without a manual coercion.
 *
 * Insert vs select split:
 *
 *  - `boardOpSelectSchema` — the on-the-wire row shape. Used by the
 *    replay-path validation (`fetch(documentName)` in the Storage
 *    adapter, the compaction sweep in Task 1.5).
 *  - `boardOpInsertSchema` — the persistence-layer insert shape.
 *    `id` is server-generated (bigserial), `createdAt` is
 *    server-defaulted. `boardId`, `opSeq`, and `update` are required.
 *    The Storage adapter's `appendOp` helper (ADR-003 internal API)
 *    inserts against this shape on every `onChange` frame.
 *
 * Inferred TypeScript types are imported from `src/db/schema/board-ops.ts`
 * (`BoardOp` / `NewBoardOp`) — one source of truth per row shape.
 */
export const boardOpSelectSchema = createSelectSchema(boardOps);
export const boardOpInsertSchema = createInsertSchema(boardOps);
