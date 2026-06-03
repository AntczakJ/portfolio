/**
 * Booking-domain schemas (ADR-003) — the shared contract between the
 * wizard form steps and the mocked submit handler (docs/conventions.md
 * § 5). Inferred types are exported alongside each schema.
 */
// Side-effect FIRST (D-CSP-1): ensure zod jitless is configured before any
// schema below compiles a JIT validator, on every import path of the barrel.
import '@/lib/zod-config';
export * from './common';
export * from './service';
export * from './barber';
export * from './availability';
export * from './contact';
export * from './booking';
export * from './testimonial';
export * from './shop';
