/// <reference types="bun-types" />

/**
 * Types-only re-export of the Elysia app.
 *
 * Consumers on the web side (`tape-web`) do `import type { App } from 'tape-server'`
 * to drive the Eden Treaty client. Keeping this shim separate from `./server`
 * (which is the runtime entrypoint that calls `app.listen` under `import.meta.main`)
 * makes the contract explicit: cross-package access is types-only.
 *
 * `import type` is erased at compile time, so nothing from this file — or
 * transitively from `./server` — reaches a runtime bundle on the web side.
 *
 * The triple-slash reference above pulls Bun's ambient globals into any
 * project that walks into this file via the package `types` entry. Without
 * it, `tape-web`'s tsc fails on `Bun.spawnSync` in `./lib/commit.ts`. The
 * reference is types-only and erased at runtime — no Bun runtime code leaks.
 */
export type { App } from './server';

/**
 * Explicit type-only re-export of the WS frame contract (Task 1.6a /
 * ADR-006).
 *
 * Why distinct from Elysia's runtime type inference: the WS path is
 * intentionally outside Eden Treaty's HTTP type-inference lane —
 * Elysia's WS handler is bytes-in / bytes-out at the framework level
 * and the codec is `msgpackr`, NOT JSON. So while the inferred `App`
 * type carries every HTTP route's request/response shape, the WS
 * frame contract is a separate Zod-derived TS shape that does not
 * reach the browser through Eden Treaty's HTTP inference. Re-exporting
 * the WS frame types from this shim gives `tape-web` a stable
 * import path (`import type { WSFrame } from 'tape-server'`) without
 * requiring the consumer to know about `lib/schemas/ws/` layout.
 *
 * This is the one place where the project's contract surface is not
 * "Eden Treaty does it all" — recorded under AGENT_NOTES "WebSocket
 * frame contract notes". Do not try to harmonise the WS frame types
 * back through Eden Treaty's HTTP layer.
 */
export type {
  WSCellClosePayload,
  WSCellDeltaPayload,
  WSControlHeartbeatPayload,
  WSControlOverrunPayload,
  WSFrame,
  WSFrameKind,
  WSReplayBarCell,
  WSReplayBarPayload,
  WSSnapshotPayload,
  WSTickPayload,
  WSTopic,
} from './lib/schemas/ws';

/**
 * Replay NDJSON line types (Task 1.7 / ADR-005).
 *
 * The replay routes (`GET /api/replay/:symbol/:date` and its `/ticks`
 * sibling) return a chunked NDJSON body — bytes to the client, NOT an
 * Eden-Treaty-typed JSON response. So the *per-line* shape does not flow
 * through the inferred `App` type the way an HTTP JSON route would; the
 * browser replay reducer (Task 3.6) parses each line itself. Re-exporting
 * the line types here gives `tape-web` a stable import path
 * (`import type { ReplayCellRow } from 'tape-server'`) so 3.6 types its
 * `JSON.parse(line) as ReplayCellRow` against the server's single source
 * of truth — same pattern as the WS frame types above, for the same
 * reason (the body is a byte stream outside Eden Treaty's HTTP lane).
 */
export type { ReplayCellRow } from './lib/schemas/replay/cell';
export type { ReplayTickRow } from './lib/schemas/replay/tick';
