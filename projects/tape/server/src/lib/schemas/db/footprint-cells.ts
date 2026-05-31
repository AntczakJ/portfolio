import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

import { footprintCells } from '../../../db/schema/footprint-cells';
import type {
  FootprintCell,
  NewFootprintCell,
} from '../../../db/schema/footprint-cells';

/**
 * Zod schemas for the `footprint_cells` row. Derived from the Drizzle
 * table — same propagation contract as `ticks` in this directory.
 *
 * The replay endpoint (Task 1.7) will chunk select-shaped rows as NDJSON
 * to the browser; the insert shape is what the Rust worker constructs at
 * bar close.
 *
 * Row TS types come from Drizzle's `$inferSelect` / `$inferInsert`
 * (`FootprintCell` / `NewFootprintCell`) re-exported here — see the
 * `ticks` schema sibling for the Zod 3 vs Zod 4 rationale behind not
 * going through `z.output<typeof schema>`.
 */
export const footprintCellSelectSchema = createSelectSchema(footprintCells);
export const footprintCellInsertSchema = createInsertSchema(footprintCells);

export type FootprintCellRow = FootprintCell;
export type FootprintCellInsert = NewFootprintCell;
