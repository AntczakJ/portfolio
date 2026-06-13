import { z } from 'zod';

import { incidentSeveritySchema, monitorStatusSchema } from './events';
import { incidentStatusSchema } from './incident';

/**
 * Public status-page READ contract (Task 6.3, ADR-003 / ADR-005 / ADR-007) —
 * the shared FE/BE shape for the unauthenticated `/status/[slug]` page.
 *
 * THE REDACTION BOUNDARY (the privacy guarantee, ADR-003): this surface exposes
 * STRICTLY the calm, public subset — a monitor's NAME + current up/degraded/down
 * status + an uptime %, and recent incidents (severity + window). It NEVER
 * carries:
 *   - raw response times (no `responseTimeMs`, no series, no per-check timing),
 *   - alert / channel data,
 *   - private monitors (only `public_status_page_monitors` rows appear),
 *   - the owner / user id, the target URL host beyond what is shown, secrets.
 * The shape itself enforces this — there is simply no field for a response time
 * or an alert here, so a private field cannot be serialized by accident.
 */

/** Overall page status derived from the worst public-monitor status. */
export const publicOverallStatusSchema = z.enum([
  'operational',
  'degraded',
  'outage',
]);
export type PublicOverallStatus = z.infer<typeof publicOverallStatusSchema>;

/**
 * One public monitor row. Deliberately MINIMAL — name + status + uptime only.
 * No target URL, no response time, no interval, no thresholds. The `name` is
 * what the owner chose to show publicly.
 */
export const publicMonitorSchema = z.object({
  /** A stable id so the UI can key the row (the monitor id; not sensitive). */
  id: z.uuid(),
  name: z.string(),
  /** current up / degraded / down (null = never checked / unknown). */
  status: monitorStatusSchema.nullable(),
  /** Rolling 30-day uptime %, 0..100, null when there is no observed data. */
  uptimePercent: z.number().min(0).max(100).nullable(),
});
export type PublicMonitor = z.infer<typeof publicMonitorSchema>;

/**
 * One public incident row. Carries the human-meaningful window + severity, NOT
 * any check timing or alert delivery data. `cause` is the failing-condition
 * snapshot the owner's monitor recorded (e.g. "down after 3 consecutive down
 * checks") — safe public text, no internal detail.
 */
export const publicIncidentSchema = z.object({
  id: z.uuid(),
  monitorId: z.uuid(),
  monitorName: z.string(),
  status: incidentStatusSchema,
  severity: incidentSeveritySchema,
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative(),
  cause: z.string(),
});
export type PublicIncident = z.infer<typeof publicIncidentSchema>;

/** The full public status-page payload `GET /public/:slug` returns. */
export const publicStatusPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Derived from the worst current monitor status (the banner). */
  overall: publicOverallStatusSchema,
  /** Server time the snapshot was computed (for "updated Ns ago"). */
  generatedAt: z.iso.datetime(),
  monitors: z.array(publicMonitorSchema),
  /** Recent incidents across the page's public monitors, newest first. */
  incidents: z.array(publicIncidentSchema),
});
export type PublicStatusPage = z.infer<typeof publicStatusPageSchema>;
