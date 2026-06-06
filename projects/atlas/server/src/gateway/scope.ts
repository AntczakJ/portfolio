import type { VehicleTelemetry } from 'atlas-shared/schemas';
import type { Bbox } from 'atlas-shared/schemas/ws';

/**
 * Per-connection subscription scope (ADR-003 C1) — server-side scoping.
 *
 * The default is the WHOLE fleet (`vehicleIds === null && bbox === null`), so
 * first paint is populated with no client narrowing. A focused client narrows to
 * `vehicleIds`; a zoomed client narrows to a viewport `bbox`. When both are set
 * the result is their intersection (a focused vehicle inside the viewport).
 *
 * Scoping is enforced HERE, server-side — the client frame only expresses intent
 * (`subscribe`), never trusted to filter its own data. A vehicle not in scope is
 * simply not sent to that connection.
 */
export interface Scope {
  /** Explicit vehicle id allowlist, or null for "all vehicles". */
  readonly vehicleIds: ReadonlySet<string> | null;
  /** Viewport bounding box, or null for "anywhere". */
  readonly bbox: Bbox | null;
}

/** The whole-fleet default scope. */
export const DEFAULT_SCOPE: Scope = { vehicleIds: null, bbox: null };

/** True when the scope imposes no narrowing (the common whole-fleet fast path). */
export function isWholeFleet(scope: Scope): boolean {
  return scope.vehicleIds === null && scope.bbox === null;
}

/** Whether a single telemetry row is inside the connection's scope. */
export function inScope(scope: Scope, t: VehicleTelemetry): boolean {
  if (scope.vehicleIds !== null && !scope.vehicleIds.has(t.vehicleId)) return false;
  if (scope.bbox !== null) {
    const [west, south, east, north] = scope.bbox;
    if (t.lng < west || t.lng > east || t.lat < south || t.lat > north) return false;
  }
  return true;
}

/** Filter a telemetry list down to the connection's scope (server-side cull). */
export function filterTelemetry(
  scope: Scope,
  telemetry: readonly VehicleTelemetry[],
): VehicleTelemetry[] {
  if (isWholeFleet(scope)) return [...telemetry];
  return telemetry.filter((t) => inScope(scope, t));
}
