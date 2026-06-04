import { z } from 'zod';

import {
  wsCellClosePayloadSchema,
  wsCellDeltaPayloadSchema,
  wsReplayBarPayloadSchema,
} from './cell';
import {
  wsControlHeartbeatPayloadSchema,
  wsControlOverrunPayloadSchema,
} from './control';
import { wsSnapshotPayloadSchema } from './snapshot';
import { wsTickPayloadSchema } from './tick';

/**
 * WebSocket frame envelope — top-level discriminated union the
 * Elysia fan-out endpoint (Task 1.6b) emits and the browser client
 * (Task 2.6) consumes.
 *
 * The wire shape is `{ topic, kind, payload }`. Per ADR-006 the
 * codec is MessagePack via `msgpackr` (`useRecords: false`); the
 * Zod schemas in this directory validate the decoded JS object on
 * both ends of the wire.
 *
 * **Discriminator model.** `kind` is the discriminator — it is the
 * minimum information needed to route to the right payload
 * validator. `topic` is a routing label that prepares for
 * multi-symbol v2 (`'ticks.eth'`, `'cells.sol'`, etc.) without a
 * protocol bump; in v1 it is constrained to the three values below.
 * The browser consumer typically branches on `kind` first
 * (mutation type) and on `topic` second (which store to apply it
 * to); the schema enforces both.
 *
 * **v1 topic vocabulary.**
 *
 *   - `'ticks.btc'`  — Live aggTrade frames for BTC-PERP.
 *   - `'cells.btc'`  — Live cell delta + cell close frames for
 *                       BTC-PERP. Snapshot frames also ride here
 *                       (the snapshot payload composes both cell
 *                       histories and the recent tick ring).
 *   - `'control'`    — Out-of-band lifecycle: overrun, heartbeat.
 *                       Symbol-agnostic.
 *
 * **v2 extension story (encoded into the wire, not into the
 * schema's enum).** Adding ETH-PERP / SOL-PERP in v2 means adding
 * `'ticks.eth'` / `'cells.eth'` / `'ticks.sol'` / `'cells.sol'` to
 * `wsTopicSchema` (one edit) and growing the server-side
 * subscription manager (out of scope here). The channel model
 * stays single-socket. ADR-007 is NOT pre-allocated — it lands
 * only when a real per-topic backpressure issue forces it
 * (recorded under AGENT_NOTES "Decisions to revisit"). The
 * forward-compatible affordance is built in today; the protocol
 * does not change tomorrow.
 *
 * **Frame kinds in v1.** Six kinds total — the discriminator
 * vocabulary the browser switches on:
 *
 *   1. `'tick'`               — A single aggTrade. Payload =
 *                                `wsTickPayloadSchema`. Topic =
 *                                `'ticks.btc'`.
 *   2. `'cell.delta'`         — Mid-bar additive mutation on a
 *                                cell. Payload =
 *                                `wsCellDeltaPayloadSchema`.
 *                                Topic = `'cells.btc'`.
 *   3. `'cell.close'`         — Bar-boundary absolute totals.
 *                                Payload =
 *                                `wsCellClosePayloadSchema`.
 *                                Topic = `'cells.btc'`.
 *   4. `'snapshot'`           — Server-pushed first frame on
 *                                connect. Payload =
 *                                `wsSnapshotPayloadSchema`. Topic =
 *                                `'cells.btc'` in v1 (the snapshot
 *                                payload composes both cells and
 *                                ticks history into one frame so
 *                                the browser does not have to
 *                                stitch two snapshots).
 *   5. `'control.overrun'`    — Pre-disconnect notice (ADR-006
 *                                circuit breaker). Payload =
 *                                `wsControlOverrunPayloadSchema`.
 *                                Topic = `'control'`.
 *   6. `'control.heartbeat'`  — Periodic liveness. Payload =
 *                                `wsControlHeartbeatPayloadSchema`.
 *                                Topic = `'control'`.
 *
 * `'replay.bar'` (Task 3.6) is now a live variant — it carries one
 * historic bar's absolute cell totals, materialised by the browser
 * replay engine as the virtual clock crosses each `bucketTs` boundary
 * (REPLAY mode only; the live server fan-out never emits it). Kinds
 * still reserved by ADR-004 / ADR-006 but NOT shipped:
 * `'control.worker_ready'`, `'control.worker_unavailable'`,
 * `'control.replay_complete'`, `'control.error'`. Each is one
 * additional variant in the discriminated union when its task ships —
 * not a protocol bump.
 *
 * **No fallback parsing.** The envelope's
 * `z.discriminatedUnion('kind', ...)` produces a single Zod parse
 * error per bad frame. Callers throw — they never accept a partial
 * or undefined payload. Validation at the boundary, per
 * docs/conventions.md § 5 and ADR-006 § "Browser receive-side
 * validates EVERY frame through Zod".
 */
export const wsTopicSchema = z.enum(['ticks.btc', 'cells.btc', 'control']);

export type WSTopic = z.infer<typeof wsTopicSchema>;

export const wsFrameKindSchema = z.enum([
  'tick',
  'cell.delta',
  'cell.close',
  'replay.bar',
  'snapshot',
  'control.overrun',
  'control.heartbeat',
]);

export type WSFrameKind = z.infer<typeof wsFrameKindSchema>;

/**
 * Discriminated union envelope.
 *
 * The discriminator field is `kind`; `topic` is constrained to its
 * legal values per-variant via `z.literal(...)`. Zod's discriminated
 * union matches on `kind` first, then validates the rest of the
 * object against the matched variant — so a `{ kind: 'tick', topic:
 * 'cells.btc', ... }` payload fails parse (wrong topic for kind),
 * which is the correct behaviour and the reason both fields are
 * fixed per-variant rather than left loose at the envelope level.
 */
export const wsFrameEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    topic: z.literal('ticks.btc'),
    kind: z.literal('tick'),
    payload: wsTickPayloadSchema,
  }),
  z.object({
    topic: z.literal('cells.btc'),
    kind: z.literal('cell.delta'),
    payload: wsCellDeltaPayloadSchema,
  }),
  z.object({
    topic: z.literal('cells.btc'),
    kind: z.literal('cell.close'),
    payload: wsCellClosePayloadSchema,
  }),
  z.object({
    topic: z.literal('cells.btc'),
    kind: z.literal('replay.bar'),
    payload: wsReplayBarPayloadSchema,
  }),
  z.object({
    topic: z.literal('cells.btc'),
    kind: z.literal('snapshot'),
    payload: wsSnapshotPayloadSchema,
  }),
  z.object({
    topic: z.literal('control'),
    kind: z.literal('control.overrun'),
    payload: wsControlOverrunPayloadSchema,
  }),
  z.object({
    topic: z.literal('control'),
    kind: z.literal('control.heartbeat'),
    payload: wsControlHeartbeatPayloadSchema,
  }),
]);

export type WSFrame = z.infer<typeof wsFrameEnvelopeSchema>;
