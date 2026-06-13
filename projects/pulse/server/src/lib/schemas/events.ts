import { z } from 'zod';

/**
 * The SSE event contract (ADR-003) — the cross-package real-time wire format.
 *
 * This file is the single source of truth for the live channel. The web side
 * (`pulse-web`) imports the inferred TYPES from here (types-only, via the
 * package `./events` export — see src/contract.ts) to drive its EventSource
 * wiring; the server validates every event it relays against the runtime
 * schemas here. Because the web import is `import type`, the Zod runtime
 * never reaches the browser bundle (verbatimModuleSyntax erases it), the same
 * discipline meld uses for its WS frame contract.
 *
 * IMPORTANT (PROGRESS gate): frontend Phase 3.3 (the EventSource client)
 * depends on this file. Do not rename the event-type literals or reshape the
 * envelope without updating the web consumer — this is the contract that
 * cannot be allowed to drift.
 *
 * Envelope (ADR-003): every event is `{ id, type, ts, scope, payload }`.
 *   - `id`    : monotonic per-stream sequence, the `Last-Event-ID` cursor.
 *   - `type`  : the named SSE event (the discriminator).
 *   - `ts`    : server emit time (epoch ms).
 *   - `scope` : the routing key — `dashboard:<userId>` or `public:<pageId>`.
 *   - `payload`: the type-specific body.
 *
 * Named-event vocabulary (ADR-003):
 *   check.result · status.change · incident.open · incident.close ·
 *   alert.fired · heartbeat
 */

/** Derived per-check / per-monitor status (ADR-002 classification). */
export const monitorStatusSchema = z.enum(['up', 'degraded', 'down']);
export type MonitorStatus = z.infer<typeof monitorStatusSchema>;

/** Incident severity (ADR-004). `down` dominates `degraded`. */
export const incidentSeveritySchema = z.enum(['degraded', 'down']);
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;

/** Alert delivery transition (ADR-005). */
export const alertTransitionSchema = z.enum(['open', 'close']);
export type AlertTransition = z.infer<typeof alertTransitionSchema>;

// ---------------------------------------------------------------------------
// Per-event payloads
// ---------------------------------------------------------------------------

/**
 * `check.result` — highest volume. Drives sparkline appends and the
 * "last checked Ns ago" ticker. Coalesced per monitor under backpressure
 * (ADR-003), so a slow consumer drops intermediate points.
 */
export const checkResultEventSchema = z.object({
  monitorId: z.uuid(),
  status: monitorStatusSchema,
  statusCode: z.number().int().nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  checkedAt: z.iso.datetime(),
});
export type CheckResultEvent = z.infer<typeof checkResultEventSchema>;

/**
 * `status.change` — emitted only when a monitor's derived status transitions,
 * so the board can pulse the dot without diffing every `check.result`.
 */
export const statusChangeEventSchema = z.object({
  monitorId: z.uuid(),
  from: monitorStatusSchema,
  to: monitorStatusSchema,
  at: z.iso.datetime(),
});
export type StatusChangeEvent = z.infer<typeof statusChangeEventSchema>;

/** `incident.open` — an incident materialised on the board. */
export const incidentOpenEventSchema = z.object({
  incidentId: z.uuid(),
  monitorId: z.uuid(),
  severity: incidentSeveritySchema,
  startedAt: z.iso.datetime(),
  cause: z.string(),
});
export type IncidentOpenEvent = z.infer<typeof incidentOpenEventSchema>;

/** `incident.close` — an incident auto-resolved; carries the final duration. */
export const incidentCloseEventSchema = z.object({
  incidentId: z.uuid(),
  monitorId: z.uuid(),
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type IncidentCloseEvent = z.infer<typeof incidentCloseEventSchema>;

/**
 * `alert.fired` — drives the toast. NEVER carries the webhook secret
 * (ADR-003); only the metadata the board needs to confirm a delivery.
 */
export const alertFiredEventSchema = z.object({
  incidentId: z.uuid(),
  monitorId: z.uuid(),
  channelType: z.enum(['webhook', 'email']),
  transition: alertTransitionSchema,
  deliveredAt: z.iso.datetime(),
  status: z.enum(['sent', 'failed']),
});
export type AlertFiredEvent = z.infer<typeof alertFiredEventSchema>;

/** `heartbeat` — every 15 s, keeps the connection under the Fly edge idle
 * timeout and lets the client detect a dead link (ADR-003). */
export const heartbeatEventSchema = z.object({
  ts: z.number().int().nonnegative(),
});
export type HeartbeatEvent = z.infer<typeof heartbeatEventSchema>;

// ---------------------------------------------------------------------------
// The discriminated envelope
// ---------------------------------------------------------------------------

/** The named-event vocabulary, as a const tuple for reuse. */
export const SSE_EVENT_TYPES = [
  'check.result',
  'status.change',
  'incident.open',
  'incident.close',
  'alert.fired',
  'heartbeat',
] as const;

export const sseEventTypeSchema = z.enum(SSE_EVENT_TYPES);
export type SseEventType = z.infer<typeof sseEventTypeSchema>;

/** The routing scope (ADR-003): `dashboard:<userId>` or `public:<pageId>`. */
export const sseScopeSchema = z
  .string()
  .regex(
    /^(dashboard|public):[A-Za-z0-9_-]+$/,
    'scope must be `dashboard:<id>` or `public:<id>`',
  );
export type SseScope = z.infer<typeof sseScopeSchema>;

/** Fields shared by every envelope, independent of the payload. */
const envelopeBase = {
  id: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  scope: sseScopeSchema,
};

/**
 * The full event envelope: a discriminated union on `type` so a consumer can
 * narrow `payload` exhaustively (TypeScript checks the switch is total).
 */
export const sseEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelopeBase, type: z.literal('check.result'), payload: checkResultEventSchema }),
  z.object({ ...envelopeBase, type: z.literal('status.change'), payload: statusChangeEventSchema }),
  z.object({ ...envelopeBase, type: z.literal('incident.open'), payload: incidentOpenEventSchema }),
  z.object({ ...envelopeBase, type: z.literal('incident.close'), payload: incidentCloseEventSchema }),
  z.object({ ...envelopeBase, type: z.literal('alert.fired'), payload: alertFiredEventSchema }),
  z.object({ ...envelopeBase, type: z.literal('heartbeat'), payload: heartbeatEventSchema }),
]);

/** The canonical wire type the web side consumes (types-only). */
export type SseEvent = z.infer<typeof sseEventSchema>;

/** A handy map from event type to its payload type, for the web reducer. */
export interface SseEventPayloadMap {
  'check.result': CheckResultEvent;
  'status.change': StatusChangeEvent;
  'incident.open': IncidentOpenEvent;
  'incident.close': IncidentCloseEvent;
  'alert.fired': AlertFiredEvent;
  heartbeat: HeartbeatEvent;
}
