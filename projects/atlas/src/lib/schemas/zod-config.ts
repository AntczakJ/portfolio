import { z } from 'zod';

/**
 * Global Zod runtime configuration — a deliberate early side-effect (ADR-003,
 * AGENT_NOTES "MapLibre + strict CSP" / Zod JIT note).
 *
 * Zod 4 compiles validators with a `new Function(...)` JIT by default for
 * speed. Under the strict, no-`unsafe-eval` Content-Security-Policy Atlas ships
 * (ADR-006), that JIT path is blocked at runtime. The WebSocket frame contract
 * is validated AT RUNTIME on every inbound control frame (the server) and on
 * every relayed frame, so the JIT would actually be hit on a hot path under the
 * CSP — turning a perf optimisation into a thrown CSP violation.
 *
 * `z.config({ jitless: true })` switches Zod to its interpreter, which uses no
 * dynamic code evaluation and is CSP-safe. The cost is a small per-parse
 * overhead, irrelevant at Atlas's frame volume (a few KB of JSON at 1 Hz).
 *
 * This module is imported FIRST, before any schema is defined, so the flag is
 * set before any validator is built. The schema barrel imports it at the top;
 * the server entrypoint imports it explicitly as its very first import. Both
 * paths converge on the same idempotent global.
 */
z.config({ jitless: true });

export {};
