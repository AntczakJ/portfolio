/**
 * Drizzle schema barrel.
 *
 * One table per file keeps `drizzle-kit generate` diffs surgical. The
 * trade-level table joins in Task 1.3; the worker bridge schemas live
 * under `src/lib/schemas/bridge/` (Rust source of truth, ts-rs generated).
 *
 * Phase 1 / Task 1.2a additions:
 *   - `ticks`            — raw aggTrade archive, monthly-partitioned
 *                          (partitioning declared in the migration SQL,
 *                          not in this DSL — see `ticks.ts` docblock).
 *   - `footprint_cells`  — close-time totals, unpartitioned, written by
 *                          the Rust worker on bar-close (ADR-005 / -004).
 */
export * from './sessions';
export * from './ticks';
export * from './footprint-cells';
