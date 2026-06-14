import { z } from 'zod';

/**
 * Zod runtime configuration — strict-CSP safety (ADR-002 §6).
 *
 * Zod 4 ships a JIT fast-path that probes `Function('')` once to feature-detect
 * whether `eval` / `'unsafe-eval'` is allowed. Under nocturne's strict
 * production CSP (`script-src 'self' 'unsafe-inline'`, NO `'unsafe-eval'`) that
 * probe is BLOCKED — zod swallows the throw and falls back to the interpreted
 * path, so nothing breaks functionally, BUT the browser still fires a
 * `securitypolicyviolation` report for the blocked `Function` call. The quality
 * bar is ZERO CSP violations, so we opt zod out of the probe entirely via
 * `jitless: true` (zod's documented escape — the apex precedent).
 *
 * GLOBAL + EARLY: the probe fires the FIRST time any zod validator JIT-compiles
 * (lazily, on the first `.parse()`/`.safeParse()`). This side-effect runs BEFORE
 * any schema is defined — imported at the top of the schema barrel, the preset
 * schema, the root layout, and the providers — so on EVERY route (server or
 * client) `jitless` is configured before any validator compiles. The call is
 * idempotent, so multiple import sites are harmless.
 */
z.config({ jitless: true });
