import { z } from 'zod';

import { polygonGeometrySchema } from './geojson';
import { zoneKindSchema } from './enums';

/**
 * Zone / geofence — a polygon the engine tests each vehicle against (ADR-004 /
 * ADR-005). Depots + delivery zones + restricted areas, hand-drawn for the demo
 * city. A `geofence.enter` / `geofence.exit` event fires when a vehicle's
 * CONFIRMED inside/outside state flips (the hysteresis state machine, ADR-004),
 * not on the raw per-tick point-in-polygon — so boundary skimming does not
 * flap.
 */
export const zoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: zoneKindSchema,
  geometry: polygonGeometrySchema,
});
export type Zone = z.infer<typeof zoneSchema>;
