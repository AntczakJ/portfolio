/**
 * Mock-data barrel (Task 3.2).
 *
 * All apex mock data, parsed through the shared Zod schemas from the static
 * baked seed (`seed-data.ts` — faker ran at authoring time only, ADR-002 §5).
 * The TanStack Query mock layer (ADR-003, Phase 5) wraps these in async
 * functions with artificial latency; there is no network in v1.
 */
export * from './fleet';
export * from './configurator';
export * from './locations';
export * from './extras';
export * from './bookings';
export * from './testimonials';
export * from './shop';
