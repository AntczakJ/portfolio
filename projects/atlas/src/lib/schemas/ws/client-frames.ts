import { z } from 'zod';

import { MAX_SEEK_TICK } from './protocol';

/**
 * Client -> server WebSocket frames (ADR-003). The bidirectional control
 * channel that justifies WebSocket over SSE (ADR-001): subscription scoping,
 * snapshot resync, and demo simulation control over the one socket.
 *
 * THIS IS AN INPUT SURFACE. Every inbound frame is Zod-validated at the gateway
 * boundary; a malformed control frame is dropped (not crashed on) and the
 * connection is rate-limited (ADR-003). Never trust the client to scope its own
 * data — the server enforces scoping server-side; these frames only express
 * intent.
 */

/**
 * A viewport bounding box `[west, south, east, north]` in degrees. Used by
 * `subscribe` to cull off-screen vehicles from the per-tick delta server-side.
 */
export const bboxSchema = z
  .tuple([
    z.number().min(-180).max(180), // west (min longitude)
    z.number().min(-90).max(90), // south (min latitude)
    z.number().min(-180).max(180), // east (max longitude)
    z.number().min(-90).max(90), // north (max latitude)
  ])
  // Reject a degenerate/inverted box (west>=east or south>=north) at the
  // boundary: an inverted box would otherwise silently cull EVERYTHING in the
  // server-side filter. The filter still degrades safely to "empty" for any box
  // that slips past, but rejecting here is the honest "validate at the boundary"
  // posture — the malformed frame is dropped, never trusted.
  .refine(([west, south, east, north]) => west < east && south < north, {
    message: 'bbox must satisfy west < east and south < north',
  });
export type Bbox = z.infer<typeof bboxSchema>;

/**
 * Narrow the per-tick delta this connection receives. Both fields are optional;
 * omitting both is the whole-fleet default (first paint is populated). A
 * focused client narrows to `vehicleIds`; a zoomed client narrows to `bbox`.
 */
export const subscribeFrameSchema = z.object({
  t: z.literal('subscribe'),
  vehicleIds: z.array(z.string().min(1)).optional(),
  bbox: bboxSchema.optional(),
});
export type SubscribeFrame = z.infer<typeof subscribeFrameSchema>;

/** Clear any narrowing and return to the whole-fleet subscription. */
export const unsubscribeFrameSchema = z.object({
  t: z.literal('unsubscribe'),
});
export type UnsubscribeFrame = z.infer<typeof unsubscribeFrameSchema>;

/**
 * Force a fresh `snapshot` (reconnect resync, or recovery from a detected `seq`
 * gap). The gateway debounces these so a flapping connection cannot
 * snapshot-storm the server (ADR-003).
 */
export const snapshotRequestFrameSchema = z.object({
  t: z.literal('snapshot.request'),
});
export type SnapshotRequestFrame = z.infer<typeof snapshotRequestFrameSchema>;

/**
 * Demo simulation control (ADR-002 / Task 5.4). Drives the reproducible wow
 * beat: pause/resume the loop, scale the demo speed (ticks-per-real-second in
 * the shell, NEVER the reducer dt), and seek to a known tick (a deterministic
 * fold from the baseline). `action` discriminates the payload.
 */
export const simControlFrameSchema = z.discriminatedUnion('action', [
  z.object({ t: z.literal('sim.control'), action: z.literal('pause') }),
  z.object({ t: z.literal('sim.control'), action: z.literal('resume') }),
  z.object({
    t: z.literal('sim.control'),
    action: z.literal('setSpeed'),
    /** Demo speed multiplier (ticks per real second), bounded sane. */
    multiplier: z.number().positive().max(16),
  }),
  z.object({
    t: z.literal('sim.control'),
    action: z.literal('seek'),
    /**
     * Absolute target tick index to fold the reducer to from the baseline.
     * BOUNDED at `MAX_SEEK_TICK` — `seek` is a synchronous reducer fold, so an
     * unbounded target is an event-loop DoS (see `MAX_SEEK_TICK`). The engine
     * also clamps defensively (defence in depth, mirroring the `setSpeed` cap).
     */
    tick: z.number().int().nonnegative().max(MAX_SEEK_TICK),
  }),
]);
export type SimControlFrame = z.infer<typeof simControlFrameSchema>;

/**
 * The client -> server frame union. The gateway parses every inbound message
 * against this and drops anything that does not match.
 */
export const clientFrameSchema = z.union([
  subscribeFrameSchema,
  unsubscribeFrameSchema,
  snapshotRequestFrameSchema,
  simControlFrameSchema,
]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;
