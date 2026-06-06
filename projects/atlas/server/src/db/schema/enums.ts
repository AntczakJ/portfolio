import { pgEnum } from 'drizzle-orm/pg-core';

import {
  EVENT_TYPES,
  LOOP_MODES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  ZONE_KINDS,
} from 'atlas-shared/schemas';

/**
 * Shared Postgres enums (ADR-005). The const tuples come from the shared
 * contract package (atlas-shared) so the DB-level type vocabulary CANNOT drift
 * from the Zod enums the wire uses (conventions section 5, applied to enums).
 *
 * pgEnum requires a non-empty readonly string tuple; the shared `as const`
 * tuples satisfy that directly.
 */

/** Vehicle kind (van | truck | courier). */
export const vehicleTypeEnum = pgEnum('vehicle_type', VEHICLE_TYPES);

/** Live vehicle status (en_route | at_stop | idle | returning). */
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES);

/** Route-end behaviour (loop | ping_pong). */
export const loopModeEnum = pgEnum('loop_mode', LOOP_MODES);

/** Zone / geofence kind (depot | delivery_zone | restricted). */
export const zoneKindEnum = pgEnum('zone_kind', ZONE_KINDS);

/** Event type (geofence.enter | geofence.exit | status.change | arrived | departed). */
export const eventTypeEnum = pgEnum('event_type', EVENT_TYPES);
