/// <reference types="node" />

/**
 * Types-only re-export of the Hono app.
 *
 * Consumers on the web side (`meld-web`) do
 *   import type { App } from 'meld-server';
 * to drive the Hono RPC client
 *   import { hc } from 'hono/client';
 *   const api = hc<App>(env.apiUrl);
 *
 * Keeping this shim separate from `./server` (which is the runtime
 * entrypoint that calls `serve(...)` under `isEntryPoint`) makes the
 * contract explicit: cross-package access from `meld-web` is types-only.
 *
 * `import type` is erased at compile time, so nothing from this file —
 * or transitively from `./server` — reaches a runtime bundle on the
 * web side. Hono's runtime stays out of the Next.js client chunk; only
 * the route-shape types travel.
 *
 * The triple-slash reference above pulls Node's ambient globals (the
 * `process` / `node:*` references inside `./server` and its imports)
 * into any project that walks into this file via the package `types`
 * entry. Without it, `meld-web`'s tsc would fail on `process.env`
 * references in `./server` and `./db`. The reference is types-only and
 * erased at runtime — no Node runtime code leaks into the browser
 * bundle.
 *
 * Pattern mirrors `tape-server/src/app.ts`. NO `packages/*` extraction
 * per `docs/conventions.md` § 13 — the cross-package types-only import
 * via the workspace is exactly the convention's Trigger-B avoidance
 * path for a project pair that only needs type sharing (not runtime).
 *
 * WS frame contract (ADR-004 — Task 1.X-control). The types-only
 * re-export block below ships the six v1 discriminated-union branches
 * plus the canonical `WSControlFrame` type. `meld-web` consumes them
 * via `import type { WSControlFrame } from 'meld-server'` and parses
 * incoming TEXT frames against its own minimal Zod schema set per
 * AGENT_NOTES "WS schemas + Drizzle schemas live in `meld-server`,
 * types-only re-exported via `meld-server/src/app.ts`".
 *
 * The Zod runtime stays out of the browser bundle because every
 * export below is a `type` re-export — `import type` is erased at
 * compile time, so the schemas they were inferred from never
 * resolve at runtime on the web side.
 */
export type { App } from './server';
export type {
  WSBoardDeletedReason,
  WSBoardMetadata,
  WSControlBoardDeletedFramePayload,
  WSControlFrame,
  WSControlFrameKind,
  WSControlKickedFramePayload,
  WSControlOverrunFramePayload,
  WSHeartbeatFramePayload,
  WSOklchColor,
  WSOverrunReason,
  WSSessionIdentity,
  WSSettingsUpdateFramePayload,
  WSWelcomeFramePayload,
} from './lib/schemas/ws';
