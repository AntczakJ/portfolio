import { z } from 'zod';

import { vehicleStatusSchema } from './enums';

/**
 * Vehicle telemetry tick — the authoritative live state of one vehicle at one
 * tick (ADR-002 / ADR-003). This is the payload the WS `snapshot` (one per
 * vehicle) and `tick` (only the changed ones) frames carry. ETA and status are
 * FOLDED IN here (ADR-003 A2) — they change WITH position every tick and must
 * not de-sync into separate frames.
 *
 * Produced by the pure tick reducer (no IO, no wall-clock); the client
 * interpolates between consecutive ticks of the same vehicle (lerp lat/lng
 * along the road geometry, shortest-arc the heading) to reach 60 fps motion off
 * 1 Hz data.
 *
 * Units are pinned (ADR-004 sharp edge): `distanceAlongRouteM` and the geo math
 * behind ETA are in METRES; `speedMps` in metres/second; `headingDeg` in
 * degrees clockwise from north [0, 360); `etaSeconds` in seconds.
 */
export const vehicleTelemetrySchema = z.object({
  vehicleId: z.string().min(1),
  /** WGS84 latitude, projected from `distanceAlongRouteM` (ADR-002). */
  lat: z.number().min(-90).max(90),
  /** WGS84 longitude. */
  lng: z.number().min(-180).max(180),
  /** Heading in degrees clockwise from north, [0, 360). */
  headingDeg: z.number().min(0).max(360),
  /** Current ground speed in metres/second (>= 0; 0 while dwelling). */
  speedMps: z.number().nonnegative(),
  routeId: z.string().min(1),
  /** Distance travelled along the route from its start, in metres. */
  distanceAlongRouteM: z.number().nonnegative(),
  /** Fraction of the route completed, [0, 1]. */
  progress: z.number().min(0).max(1),
  status: vehicleStatusSchema,
  /** The id of the stop the vehicle is heading toward, or null at route end. */
  nextStopId: z.string().min(1).nullable(),
  /**
   * Estimated seconds to the next stop, from remaining distance over the
   * rolling-average speed (ADR-004), clamped at a floor. Null when there is no
   * next stop or no meaningful estimate (e.g. fully stopped with no rolling
   * average yet).
   */
  etaSeconds: z.number().nonnegative().nullable(),
  /** The id of the zone the vehicle is currently CONFIRMED inside, or null. */
  currentZoneId: z.string().min(1).nullable(),
});
export type VehicleTelemetry = z.infer<typeof vehicleTelemetrySchema>;
