import { z } from 'zod';

/**
 * Zod runtime configuration — strict-CSP safety (the razors-edge fix,
 * carried forward because Pulse's live SSE board validates events at
 * RUNTIME against the shared Zod envelope, so jitless matters even more
 * here than on a form-only surface).
 *
 * Zod 4 ships a JIT fast-path that probes `new Function('')` once to
 * feature-detect whether `eval` / `unsafe-eval` is allowed. Under our
 * strict production CSP (`script-src 'self' 'unsafe-inline'`, NO
 * `unsafe-eval`) that probe is BLOCKED — zod swallows the throw and falls
 * back to the interpreted path, so nothing breaks functionally, BUT the
 * browser still fires a `securitypolicyviolation` report for the blocked
 * `Function` call. Our quality bar is ZERO CSP violations, so we opt zod
 * out of the probe entirely via `jitless: true` (zod's own documented
 * escape for exactly this case).
 *
 * GLOBAL + EARLY. The probe fires the FIRST time any validator
 * JIT-compiles (lazily, on the first `.parse()` / `.safeParse()`). To
 * guarantee `jitless` is set before ANY validator can compile — including
 * the SSE-envelope validator that runs on every pushed event — this
 * module is imported as a side-effect at the very top of the root layout
 * (and re-imported by the shared schema foundation once it lands). The
 * call is idempotent, so multiple import sites are harmless.
 */
z.config({ jitless: true });
