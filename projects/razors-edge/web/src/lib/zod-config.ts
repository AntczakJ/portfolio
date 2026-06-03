import { z } from 'zod';

/**
 * Zod runtime configuration — strict-CSP safety.
 *
 * Zod 4 ships a JIT fast-path for validators that probes `new Function('')`
 * once to feature-detect whether `eval`/`unsafe-eval` is allowed. Under our
 * strict production CSP (`script-src 'self' 'unsafe-inline'`, NO
 * `unsafe-eval`) that probe is BLOCKED — zod swallows the throw and falls
 * back to the interpreted path, so nothing breaks functionally, BUT the
 * browser still fires a `securitypolicyviolation` report for the blocked
 * `Function` call. Our quality bar is ZERO CSP violations, so we opt zod out
 * of the probe entirely via `jitless: true` (zod's own documented escape for
 * exactly this case — see `allowsEval` in `zod/v4/core/util`).
 *
 * The cost is negligible (a handful of contact-form fields validate on the
 * interpreted path); the win is a clean CSP with no `unsafe-eval` grant.
 *
 * D-CSP-1 fix — GLOBAL + EARLY. The probe fires the FIRST time any zod
 * validator JIT-compiles (lazily, on the first `.parse()`/`.safeParse()`).
 * Setting `jitless` only in `Providers` covered `/book` (where a validator
 * compiles eagerly) but NOT `/`, where the first validator compiled lazily
 * on a theme-toggle click and the probe slipped through. The robust fix is
 * to make this a side-effect that runs BEFORE any schema is even defined:
 * it is imported at the very top of the schema foundation (`schemas/common`,
 * which every other schema builds on) AND of the schema barrel AND of the
 * root layout — so on EVERY route, server or client, `jitless` is configured
 * before a single zod validator can compile a JIT path. The call is
 * idempotent, so multiple import sites are harmless.
 */
z.config({ jitless: true });
