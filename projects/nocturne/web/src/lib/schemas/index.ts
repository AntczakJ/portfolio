// Side-effect FIRST (ADR-002 §6): configure zod jitless before re-exporting any
// schema, so importers of the barrel never compile a JIT validator under the
// strict no-`unsafe-eval` CSP (which would fire a securitypolicyviolation).
import '@/lib/zod-config';

/**
 * Schema barrel — the shared nocturne contracts (Task 3.1).
 *
 * The single source of truth for the Preset shape, the audio-source kind, the
 * audio-bands analysis output, the tier config, and the HUD state — imported by
 * the curated presets (Task 3.2), the pure logic (Tasks 3.3/3.4), the engine +
 * HUD (Pass 2/3), and the tests (Phase 7).
 */
export * from './audio-source';
export * from './audio-bands';
export * from './preset';
export * from './tier';
export * from './hud-state';
