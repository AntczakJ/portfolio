// Side-effect FIRST (ADR-002 §5): the schema barrel configures zod jitless
// before re-exporting any schema, so importers of the barrel never compile a
// JIT validator under the strict no-`unsafe-eval` CSP.
import '@/lib/zod-config';

/**
 * Schema barrel — the shared apex contract (Task 3.1).
 *
 * The single source of truth for the reservation payload + the catalog shapes,
 * imported by the wizard form steps (RHF + zodResolver), the TanStack Query
 * mock layer, the mocked `reserveVehicle` submit, and the tests
 * (docs/conventions.md § 5).
 */
export * from './common';
export * from './vehicle';
export * from './configurator-option';
export * from './location';
export * from './extra';
export * from './vehicle-booking';
export * from './availability';
export * from './price-quote';
export * from './driver';
export * from './testimonial';
export * from './shop';
export * from './reservation-draft';
