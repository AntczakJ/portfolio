import { z } from 'zod';

import { simEventSchema } from '../event';
import { routeSchema } from '../route';
import { routeStopSchema } from '../stop';
import { vehicleTelemetrySchema } from '../telemetry';
import { vehicleSchema } from '../vehicle';
import { zoneSchema } from '../zone';
import { PROTOCOL_VERSION } from './protocol';

/**
 * Server -> client WebSocket frames (ADR-003). Every frame is a member of a
 * single tagged union on `t`, and carries a monotonic `seq` for gap detection
 * (the client requests a fresh snapshot on a detected gap rather than trusting
 * stale deltas).
 *
 * Frame vocabulary:
 *   - `snapshot`  : full authoritative world (sent on connect / reconnect /
 *                   on `snapshot.request`). Carries `protocolVersion`.
 *   - `tick`      : per-tick delta — ONLY the vehicles whose telemetry changed
 *                   this tick. ETA + status are folded into the telemetry.
 *   - `event`     : a SimEvent for the feed (geofence enter/exit, status
 *                   change, arrived/departed).
 *   - `heartbeat` : every 20 s, carries the server tick index for liveness.
 */

/** Shared `seq` field — a monotonic per-stream sequence for gap detection. */
const seq = z.number().int().nonnegative();

/**
 * The full world definition + current state. The static definitions (routes,
 * stops, zones, vehicle metadata) let a fresh client render the map without a
 * separate REST round trip; `telemetry` is the current authoritative position
 * of every vehicle.
 */
export const snapshotFrameSchema = z.object({
  t: z.literal('snapshot'),
  seq,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  /** The engine tick index this snapshot reflects. */
  serverTick: z.number().int().nonnegative(),
  /** Server emit time, epoch milliseconds. */
  ts: z.number().int().nonnegative(),
  vehicles: z.array(vehicleSchema),
  routes: z.array(routeSchema),
  stops: z.array(routeStopSchema),
  zones: z.array(zoneSchema),
  telemetry: z.array(vehicleTelemetrySchema),
});
export type SnapshotFrame = z.infer<typeof snapshotFrameSchema>;

/**
 * A per-tick delta: only the vehicles whose telemetry changed since the last
 * tick the connection received. Under backpressure the gateway COALESCES to the
 * latest tick per vehicle (ADR-003) — a slow consumer gets the newest position,
 * never a replayed backlog of stale ones.
 */
export const tickFrameSchema = z.object({
  t: z.literal('tick'),
  seq,
  serverTick: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  /** Changed-vehicle telemetry only (may be empty on a quiet tick). */
  telemetry: z.array(vehicleTelemetrySchema),
});
export type TickFrame = z.infer<typeof tickFrameSchema>;

/** A discrete world event for the feed. */
export const eventFrameSchema = z.object({
  t: z.literal('event'),
  seq,
  serverTick: z.number().int().nonnegative(),
  event: simEventSchema,
});
export type EventFrame = z.infer<typeof eventFrameSchema>;

/** Keep-alive + liveness/seq check (ADR-003). */
export const heartbeatFrameSchema = z.object({
  t: z.literal('heartbeat'),
  seq,
  serverTick: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
});
export type HeartbeatFrame = z.infer<typeof heartbeatFrameSchema>;

/**
 * The server -> client frame union. A consumer narrows on `t` and TypeScript
 * checks the switch is total.
 */
export const serverFrameSchema = z.discriminatedUnion('t', [
  snapshotFrameSchema,
  tickFrameSchema,
  eventFrameSchema,
  heartbeatFrameSchema,
]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;
