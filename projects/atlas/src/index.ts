/**
 * atlas-shared — the FE/BE contract package root.
 *
 * Re-exports the full schema contract and the geo module. Consumers can import
 * the whole surface from `atlas-shared`, or the focused subpaths:
 *   - `atlas-shared/schemas`     — every Zod schema + inferred type
 *   - `atlas-shared/schemas/ws`  — the WebSocket frame contract (ADR-003)
 *   - `atlas-shared/geo`         — the pure turf-backed geo functions (ADR-004)
 *
 * Importing any schema pulls in the jitless Zod global side-effect transitively
 * (ADR-003 / ADR-006).
 */
export * from './lib/schemas/index';
export * from './lib/geo/index';
