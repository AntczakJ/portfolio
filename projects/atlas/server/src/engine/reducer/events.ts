import type { EventType, VehicleStatus } from 'atlas-shared/schemas';

/**
 * Reducer events (ADR-002 / ADR-003).
 *
 * The pure reducer emits events WITHOUT a wall-clock `at` timestamp — `at` is
 * wall-clock and assigning it inside the reducer would break purity (and
 * determinism: a fold to tick N must not depend on when it ran). The reducer
 * emits a {@link ReducerEvent} carrying the tick and the typed payload; the IO
 * shell stamps the ISO `at` and the stable event id when it relays the event to
 * the WS gateway and the persistence sink, producing the shared `SimEvent`.
 *
 * A `ReducerEvent` is therefore a `SimEvent` minus `id` and `at` — the
 * deterministic core, plus the `tick` it fired on (the shell derives `at` from
 * the tick's wall-clock time and `id` from `vehicleId:tick:type`).
 */

/** Geofence enter/exit payload (mirrors the shared schema). */
export interface GeofenceReducerPayload {
  readonly zoneId: string;
  readonly zoneName: string;
}

/** Status-change payload. */
export interface StatusChangeReducerPayload {
  readonly from: VehicleStatus;
  readonly to: VehicleStatus;
}

/** Arrived/departed payload. */
export interface StopReducerPayload {
  readonly stopId: string;
  readonly stopName: string;
}

export type ReducerEventPayload =
  | GeofenceReducerPayload
  | StatusChangeReducerPayload
  | StopReducerPayload;

/**
 * An event the reducer emitted on a given tick. The shell converts it to a
 * `SimEvent` by adding a stable `id` and an ISO `at` derived from the tick.
 */
export interface ReducerEvent {
  readonly type: EventType;
  readonly tick: number;
  readonly vehicleId: string;
  /** Denormalised zone id (geofence events); null otherwise. */
  readonly zoneId: string | null;
  readonly payload: ReducerEventPayload;
}
