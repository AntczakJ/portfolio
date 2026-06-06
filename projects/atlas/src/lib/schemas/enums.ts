import { z } from 'zod';

/**
 * Shared domain vocabularies (ADR-002 / ADR-005).
 *
 * Defined ONCE here as const tuples + Zod enums, and re-used by:
 *   - the entity / telemetry / WS schemas in this package (the wire contract),
 *   - the Drizzle `pgEnum` definitions in atlas-server (the DB type vocabulary).
 * The server's pgEnums import these tuples so the DB enum and the Zod enum can
 * never drift (conventions section 5, applied to enums).
 */

/** Vehicle kind — purely presentational (marker icon + label). */
export const VEHICLE_TYPES = ['van', 'truck', 'courier'] as const;
export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

/**
 * Live vehicle status (ADR-002 speed/dwell model). `idle` is reserved for a
 * vehicle with no active route; the looping/ping-pong route-end behaviour means
 * the demo fleet never goes idle in v1, but the enum carries it for the
 * fallback table and future dispatch states.
 */
export const VEHICLE_STATUSES = ['en_route', 'at_stop', 'idle', 'returning'] as const;
export const vehicleStatusSchema = z.enum(VEHICLE_STATUSES);
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>;

/**
 * Route-end behaviour (ADR-002 F1). `loop` wraps `s` to 0 (cyclical depot
 * circuits); `ping_pong` reverses direction at the ends (linear routes). The
 * fleet is therefore always moving — no vehicle goes idle-forever on first
 * paint.
 */
export const LOOP_MODES = ['loop', 'ping_pong'] as const;
export const loopModeSchema = z.enum(LOOP_MODES);
export type LoopMode = z.infer<typeof loopModeSchema>;

/** Zone / geofence kind (ADR-005). Drives the zone fill colour + event copy. */
export const ZONE_KINDS = ['depot', 'delivery_zone', 'restricted'] as const;
export const zoneKindSchema = z.enum(ZONE_KINDS);
export type ZoneKind = z.infer<typeof zoneKindSchema>;

/**
 * Event type (ADR-003 / ADR-005). The events feed + the bounded history.
 * `geofence.enter` / `geofence.exit` come from the hysteresis state machine
 * (ADR-004); `status.change` mirrors a vehicle status transition; `arrived` /
 * `departed` bracket a dwell at a stop.
 */
export const EVENT_TYPES = [
  'geofence.enter',
  'geofence.exit',
  'status.change',
  'arrived',
  'departed',
] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;
