import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Shared Postgres enums (ADR-005). Defined once and reused across tables so
 * the DB-level type vocabulary matches the Zod contract in
 * `src/lib/schemas/`.
 */

/** Derived per-check / monitor status (ADR-002 classification). */
export const monitorStatusEnum = pgEnum('monitor_status', ['up', 'degraded', 'down']);

/** Normalised probe error class (ADR-002). */
export const checkErrorEnum = pgEnum('check_error', [
  'timeout',
  'dns',
  'connection_refused',
  'tls',
  'ssrf_blocked',
  'http_error',
  'keyword_missing',
  'unknown',
]);

/** Incident lifecycle status (ADR-004). */
export const incidentStatusEnum = pgEnum('incident_status', ['open', 'resolved']);

/** Incident severity (ADR-004). `down` dominates `degraded`. */
export const incidentSeverityEnum = pgEnum('incident_severity', ['degraded', 'down']);

/** Monitor probe method. v1 HTTP/HTTPS GET/HEAD. */
export const monitorMethodEnum = pgEnum('monitor_method', ['GET', 'HEAD']);

/** Alert channel type (ADR-005). */
export const alertChannelTypeEnum = pgEnum('alert_channel_type', ['webhook', 'email']);

/** Alert delivery transition (ADR-005 de-dup key). */
export const alertTransitionEnum = pgEnum('alert_transition', ['open', 'close']);

/** Alert delivery outcome (ADR-005). */
export const alertDeliveryStatusEnum = pgEnum('alert_delivery_status', ['sent', 'failed']);
