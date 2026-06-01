/**
 * Drizzle-derived Zod schemas barrel.
 *
 * One file per table mirrors the `src/db/schema/` layout so the
 * boundary-to-table mapping is one-to-one. Future tables (Task 1.7 auth)
 * land sibling files here without churning this barrel — call sites
 * either import from the per-table file or from the barrel.
 */
export * from './boards';
export * from './board-ops';
