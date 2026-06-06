import { z } from 'zod';

/**
 * Zod runtime configuration — strict-CSP safety (ADR-006, the pulse/apex lesson).
 *
 * Zod 4 ships a JIT fast-path that probes `new Function('')` once to
 * feature-detect whether `eval`/`unsafe-eval` is allowed. Under Atlas's strict
 * production CSP (`script-src 'self' 'unsafe-inline'`, NO `'unsafe-eval'`) that
 * probe is BLOCKED — zod swallows the throw and falls back to the interpreted
 * path, so nothing breaks functionally, BUT the browser still fires a
 * `securitypolicyviolation` report for the blocked `Function` call. Our quality
 * bar is ZERO CSP violations, so we opt zod out of the probe entirely via
 * `jitless: true` (zod's documented escape).
 *
 * This matters MORE for Atlas than for a static-form project: the live
 * WebSocket frame validation (Phase 4) Zod-parses telemetry frames at RUNTIME
 * on the client, so a JIT probe would otherwise fire on the hot path under the
 * no-`unsafe-eval` policy.
 *
 * GLOBAL + EARLY: the probe fires the FIRST time any zod validator JIT-compiles
 * (lazily, on the first `.parse()`/`.safeParse()`). The robust fix is a
 * side-effect that runs BEFORE any schema is defined — imported at the top of
 * the root layout and the providers, so on EVERY route (server or client)
 * `jitless` is configured before any validator can compile a JIT path. The call
 * is idempotent, so multiple import sites are harmless.
 */
z.config({ jitless: true });
