import { treaty } from '@elysiajs/eden';
import type { App } from 'tape-server';

import { env } from '@/lib/env';

/**
 * Type-safe Eden Treaty client targeting the Elysia control plane.
 *
 * The `App` type is sourced via `import type` only — no Bun-runtime code from
 * `tape-server` is bundled into the Next.js client. The treaty proxy is the
 * canonical call path for every HTTP route the server exposes; any future
 * Phase 2 / 3 client work uses `api.<route>.<verb>(...)` and gets compile-time
 * errors when the server's route shape drifts.
 *
 * WebSocket fan-out (Phase 1 / Task 1.6) is a separate path — Eden Treaty
 * supports `.subscribe()` for Elysia WS routes, but the wow-moment renderer
 * (Phase 3) wires raw `WebSocket` for full backpressure control. That decision
 * lives in PLAN.md Phase 3.4, not here.
 */
export const api = treaty<App>(env.apiUrl);
