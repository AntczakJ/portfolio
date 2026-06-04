/**
 * WS schema barrel — single import surface for the WS frame
 * contract.
 *
 * Consumers (the Elysia WS handler in Task 1.6b, the browser client
 * in Task 2.6, and any reviewer / test agent in between) should
 * reach for this barrel rather than the per-payload files. The
 * `wsFrameSchema` re-export is the canonical envelope; the
 * per-payload schemas are re-exported for fixture authoring and
 * boundary tests that want to validate a sub-shape in isolation.
 *
 * Per CLAUDE.md § 3 and docs/conventions.md § 13, these schemas
 * live inside `tape-server` and reach `tape-web` as types-only via
 * the Eden Treaty `import type { App } from 'tape-server'` shim
 * established by Task 2.2. The `app.ts` shim adds an explicit
 * type-only re-export of the inferred WS types so the browser
 * does not have to traverse the Elysia route signature for the
 * frame contract (the WS path is intentionally outside Eden
 * Treaty's HTTP type-inference lane per ADR-006).
 */

export {
  wsCellClosePayloadSchema,
  wsCellDeltaPayloadSchema,
  wsReplayBarCellSchema,
  wsReplayBarPayloadSchema,
} from './cell';
export type {
  WSCellClosePayload,
  WSCellDeltaPayload,
  WSReplayBarCell,
  WSReplayBarPayload,
} from './cell';

export {
  wsControlHeartbeatPayloadSchema,
  wsControlOverrunPayloadSchema,
  wsControlWorkerReadyPayloadSchema,
  wsControlWorkerUnavailablePayloadSchema,
} from './control';
export type {
  WSControlHeartbeatPayload,
  WSControlOverrunPayload,
  WSControlWorkerReadyPayload,
  WSControlWorkerUnavailablePayload,
} from './control';

export {
  wsFrameEnvelopeSchema,
  wsFrameKindSchema,
  wsTopicSchema,
} from './frame';
export type { WSFrame, WSFrameKind, WSTopic } from './frame';

export {
  WS_SNAPSHOT_CELLS_PIN,
  WS_SNAPSHOT_TICKS_PIN,
  wsSnapshotPayloadSchema,
} from './snapshot';
export type { WSSnapshotPayload } from './snapshot';

export { wsTickPayloadSchema } from './tick';
export type { WSTickPayload } from './tick';

/**
 * Canonical alias for the envelope. `wsFrameSchema` is the public
 * name new consumers should reach for; `wsFrameEnvelopeSchema` is
 * kept as the internal name to make the docblock structure
 * (envelope wraps payload) readable inside `frame.ts`.
 */
export { wsFrameEnvelopeSchema as wsFrameSchema } from './frame';
