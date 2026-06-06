import { z } from 'zod';

import { vehicleStatusSchema, vehicleTypeSchema } from './enums';

/**
 * Vehicle — the STATIC definition of a fleet member (ADR-005). Identity, label,
 * kind, route assignment, and base speed. The LIVE per-tick state (position,
 * heading, current `s`, status, current zone, ETA) is NOT here — that is the
 * telemetry tick (see `telemetry.ts`), computed authoritatively by the engine
 * every tick and never stored on this row except as a periodic snapshot.
 */
export const vehicleSchema = z.object({
  id: z.string().min(1),
  /** Human label, e.g. "Truck 7". */
  label: z.string().min(1),
  type: vehicleTypeSchema,
  routeId: z.string().min(1),
  /** Base cruise speed in metres/second (seeded per vehicle, ADR-002). */
  baseSpeedMps: z.number().positive(),
  /** Last-known status (snapshot convenience; the live value is the tick). */
  status: vehicleStatusSchema,
});
export type Vehicle = z.infer<typeof vehicleSchema>;
