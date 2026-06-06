import { z } from 'zod';

import { eventTypeSchema, vehicleStatusSchema } from './enums';

/**
 * Simulation event — a discrete thing that happened in the world (ADR-003 /
 * ADR-005). Emitted by the reducer as part of `{ state, events }`, relayed to
 * the client as a WS `event` frame, and persisted to the bounded events window
 * that backs the feed + the SSR floor.
 *
 * `at` is an ISO-8601 timestamp string (wire-friendly + Zod-validatable, the
 * pulse precedent). `payload` is a small discriminator-typed bag of extra
 * context the feed copy needs (e.g. zone name, the from/to status of a change);
 * it is type-narrowed below so a consumer can render each event row precisely.
 */

/** Geofence enter/exit context. */
export const geofenceEventPayloadSchema = z.object({
  zoneId: z.string().min(1),
  zoneName: z.string().min(1),
});
export type GeofenceEventPayload = z.infer<typeof geofenceEventPayloadSchema>;

/** Status-change context — the transition the feed announces. */
export const statusChangeEventPayloadSchema = z.object({
  from: vehicleStatusSchema,
  to: vehicleStatusSchema,
});
export type StatusChangeEventPayload = z.infer<typeof statusChangeEventPayloadSchema>;

/** Arrived/departed context — which stop the dwell bracketed. */
export const stopEventPayloadSchema = z.object({
  stopId: z.string().min(1),
  stopName: z.string().min(1),
});
export type StopEventPayload = z.infer<typeof stopEventPayloadSchema>;

/**
 * The simulation event. `zoneId` is denormalised to the top level (nullable)
 * for the `events(vehicle_id, at desc)` / zone-filtered reads (ADR-005
 * indexes); the richer per-type context lives in `payload`.
 */
export const simEventSchema = z.object({
  id: z.string().min(1),
  type: eventTypeSchema,
  vehicleId: z.string().min(1),
  /** Denormalised zone id for indexed reads; null for non-geofence events. */
  zoneId: z.string().min(1).nullable(),
  /** ISO-8601 timestamp of when the event occurred (server tick time). */
  at: z.iso.datetime(),
  /** Per-type context for the feed row. */
  payload: z.union([
    geofenceEventPayloadSchema,
    statusChangeEventPayloadSchema,
    stopEventPayloadSchema,
  ]),
});
export type SimEvent = z.infer<typeof simEventSchema>;
