/**
 * Shared Zod schema barrel (Task 1.4) — the FE/BE contract (conventions § 5).
 *
 * `events.ts` is the load-bearing cross-package one: the SSE event envelope
 * the web EventSource wiring imports (types-only). The package `./events`
 * export (src/contract.ts) points at it directly so the web side gets a clean
 * import path without pulling the whole server graph.
 */
export * from './alert-channel';
export * from './check-result';
export * from './events';
export * from './health';
export * from './incident';
export * from './incidents-list';
export * from './monitor';
export * from './monitor-detail';
export * from './public-status';
