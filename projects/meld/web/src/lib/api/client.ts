import { hc } from 'hono/client';

import { env } from '@/lib/env';

import type { App } from 'meld-server';

/**
 * Type-safe Hono RPC client targeting the Node control plane.
 *
 * The `App` type is sourced via `import type` only — no Node-runtime
 * code from `meld-server` is bundled into the Next.js client. `hono/
 * client` ships the `hc<App>(...)` constructor as a tree-shakable
 * subpath of the `hono` package; the route proxy is the canonical
 * call path for every HTTP route the server exposes.
 *
 * Usage shape (matches tape's Eden Treaty in spirit, differs in
 * mechanism per the Hono RPC convention):
 *
 *   const res = await api.health.$get();
 *   if (!res.ok) ...
 *   const body = await res.json();
 *
 * Any future Phase 2 / 3 client HTTP call uses `api.<route>.$<verb>()`
 * and gets compile-time errors when the server's route shape drifts.
 *
 * WebSocket fan-out (Phase 2.5 + Phase 3) is a SEPARATE path — Yjs's
 * `WebsocketProvider` is the canonical wire (ADR-002). Hono RPC does
 * not own that path; do not try to harmonise the WS frame contract
 * back through this client. The WS frame types are re-exported from
 * `meld-server/src/app.ts` as a separate `import type` lane per
 * ADR-004 / AGENT_NOTES "WS schemas + Drizzle schemas live in
 * `meld-server`, types-only re-exported via `meld-server/src/app.ts`".
 */
export const api = hc<App>(env.apiUrl);
