import type { SimEvent, VehicleTelemetry } from 'atlas-shared/schemas';
import type {
  EventFrame,
  HeartbeatFrame,
  ServerFrame,
  SnapshotFrame,
  TickFrame,
} from 'atlas-shared/schemas/ws';
import { PROTOCOL_VERSION } from 'atlas-shared/schemas/ws';

import type { EngineDefinitions } from '../engine/engine-service.js';

/**
 * Outbound-frame builders (ADR-003) — PURE functions that assemble the
 * server -> client frames to the shared `atlas-shared/schemas/ws` contract.
 *
 * The gateway owns the per-connection monotonic `seq`; these builders take it as
 * an argument and stamp it on each frame, so a frame's `seq` is assigned exactly
 * once at send time (gap detection on the client is reliable). The frames are
 * built TO the Zod contract shape; the gateway optionally validates them in
 * non-production as a contract self-check (the builders cannot drift from the
 * schema without the validate-in-dev step flagging it).
 *
 * No IO, no wall-clock here — the `ts` / `serverTick` are supplied by the engine
 * output the caller already holds.
 */

export interface SnapshotInput {
  readonly seq: number;
  readonly serverTick: number;
  readonly ts: number;
  readonly definitions: EngineDefinitions;
  readonly telemetry: readonly VehicleTelemetry[];
}

/**
 * The full-world `snapshot` frame (cold connect / reconnect / `snapshot.request`
 * / a deterministic `seek` result). Carries the static definitions so a fresh
 * client renders the map with no REST round trip, plus the current authoritative
 * telemetry of every vehicle in scope.
 */
export function buildSnapshotFrame(input: SnapshotInput): SnapshotFrame {
  return {
    t: 'snapshot',
    seq: input.seq,
    protocolVersion: PROTOCOL_VERSION,
    serverTick: input.serverTick,
    ts: input.ts,
    vehicles: [...input.definitions.vehicles],
    routes: [...input.definitions.routes],
    stops: [...input.definitions.stops],
    zones: [...input.definitions.zones],
    telemetry: [...input.telemetry],
  };
}

/**
 * A per-tick `tick` delta frame. `telemetry` is the changed/in-scope vehicles
 * only — under backpressure the gateway has already coalesced this to the latest
 * tick per vehicle (ADR-003), so the consumer gets the newest position, never a
 * replayed backlog of stale ones.
 */
export function buildTickFrame(
  seq: number,
  serverTick: number,
  ts: number,
  telemetry: readonly VehicleTelemetry[],
): TickFrame {
  return {
    t: 'tick',
    seq,
    serverTick,
    ts,
    telemetry: [...telemetry],
  };
}

/** An `event` frame for the feed (geofence enter/exit, status change, etc.). */
export function buildEventFrame(seq: number, serverTick: number, event: SimEvent): EventFrame {
  return {
    t: 'event',
    seq,
    serverTick,
    event,
  };
}

/** The 20 s keep-alive `heartbeat` frame (ADR-003 / ADR-007). */
export function buildHeartbeatFrame(seq: number, serverTick: number, ts: number): HeartbeatFrame {
  return {
    t: 'heartbeat',
    seq,
    serverTick,
    ts,
  };
}

export type { ServerFrame };
