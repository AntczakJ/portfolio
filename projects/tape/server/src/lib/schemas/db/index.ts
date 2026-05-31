/**
 * `drizzle-zod`-derived row schemas.
 *
 * Per AGENT_NOTES "Drizzle + Postgres notes" (Task 1.2), Drizzle table
 * definitions are the single source of truth for row shape; `drizzle-zod`
 * derives matching Zod schemas without a parallel hand-maintained
 * surface. These schemas exist for boundary validation at API edges that
 * project Drizzle rows over the wire — e.g. the replay endpoint
 * (Task 1.7) chunking `footprint_cells` rows as NDJSON.
 *
 * What lives here vs elsewhere:
 *   - Row schemas (DB-shaped)      — this directory.
 *   - WS frame schemas             — `src/lib/schemas/ws/` (Task 1.6a).
 *   - HTTP response schemas        — `src/lib/schemas/<endpoint>.ts`.
 *   - Internal bridge payloads     — `src/lib/schemas/bridge/` (ts-rs).
 *
 * Each surface has a different evolution cadence; do NOT collapse them
 * behind a "shared message" schema (ADR-006 § AGENT_NOTES).
 */
export * from './ticks';
export * from './footprint-cells';
