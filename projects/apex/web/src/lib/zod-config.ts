import { z } from 'zod';

/**
 * Zod runtime configuration — strict-CSP safety (ADR-002 §5).
 *
 * Zod 4 ships a JIT fast-path that probes `new Function('')` once to
 * feature-detect whether `eval`/`unsafe-eval` is allowed. Under apex's
 * strict production CSP (`script-src 'self' 'unsafe-inline'`, NO
 * `'unsafe-eval'`) that probe is BLOCKED — zod swallows the throw and falls
 * back to the interpreted path, so nothing breaks functionally, BUT the
 * browser still fires a `securitypolicyviolation` report for the blocked
 * `Function` call. Our quality bar is ZERO CSP violations, so we opt zod out
 * of the probe entirely via `jitless: true` (zod's documented escape).
 *
 * GLOBAL + EARLY (the razors-edge lesson): the probe fires the FIRST time
 * any zod validator JIT-compiles (lazily, on the first
 * `.parse()`/`.safeParse()`). Setting `jitless` only in `Providers` can miss
 * routes where the first validator compiles on a later interaction. The
 * robust fix is a side-effect that runs BEFORE any schema is defined — it is
 * imported at the top of the schema foundation, the schema barrel, and the
 * root layout, so on EVERY route (server or client) `jitless` is configured
 * before any zod validator can compile a JIT path. The call is idempotent,
 * so multiple import sites are harmless.
 */
z.config({ jitless: true });
