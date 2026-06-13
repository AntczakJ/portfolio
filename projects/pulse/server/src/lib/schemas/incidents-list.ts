import { z } from 'zod';

import { incidentSeveritySchema } from './events';
import { incidentStatusSchema } from './incident';

/**
 * Incident HISTORY read schemas (Phase 5 read surface) — the shared FE/BE
 * contract for the dashboard incidents view and the monitor-detail incident
 * history (ADR-004 / ADR-005).
 *
 * Two endpoints return the SAME row shape:
 *   - `GET /incidents`                  -> {@link IncidentsListResponse}
 *     (recent incidents across all of the demo user's monitors, newest first)
 *   - `GET /monitors/:id/incidents`     -> {@link IncidentsListResponse}
 *     (the same shape scoped to one owned monitor, for the detail page)
 *
 * Each row carries the incident fields PLUS the owning monitor's id / name /
 * url, so the cross-monitor `/incidents` list can render "which monitor" without
 * a second fetch. `durationMs` is the resolved duration for a closed incident,
 * or the still-accruing duration up to "now" for an open one (so the live
 * incident row can count upward off a real number); `null` only if the server
 * cannot compute it. The detail page's history list and the dashboard board's
 * incident surface both consume this — one contract, two scopes.
 */

/**
 * Query params for the incident-list endpoints. `limit` caps the payload;
 * `status` optionally filters to open-only or resolved-only (the dashboard
 * "active incidents" pane vs the full history). Both are coerced from the
 * query string and validated at the boundary.
 */
export const incidentsListQuerySchema = z.object({
  /** Max rows returned (newest first). 1..100, default 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Optional status filter; omitted = both open and resolved. */
  status: incidentStatusSchema.optional(),
});
export type IncidentsListQuery = z.infer<typeof incidentsListQuerySchema>;

/**
 * One row of an incident list — the incident joined to its monitor. The same
 * shape powers the cross-monitor dashboard list and the single-monitor detail
 * history; the monitor fields are redundant on the detail page (it already
 * knows the monitor) but keep the contract uniform.
 */
export const incidentListItemSchema = z.object({
  id: z.uuid(),
  monitorId: z.uuid(),
  monitorName: z.string(),
  monitorUrl: z.string(),
  status: incidentStatusSchema,
  severity: incidentSeveritySchema,
  startedAt: z.iso.datetime(),
  /** `null` while the incident is open. */
  resolvedAt: z.iso.datetime().nullable(),
  /**
   * Duration in ms: resolved duration for a closed incident; the duration so
   * far (started_at -> response time) for an open one, so the live row counts
   * up off a real baseline. `null` only if it cannot be computed.
   */
  durationMs: z.number().int().nonnegative().nullable(),
  /** Snapshot of the failing condition recorded when the incident opened. */
  cause: z.string(),
});
export type IncidentListItem = z.infer<typeof incidentListItemSchema>;

/**
 * The incident-list response. `monitorId` is the single-monitor scope id for
 * `GET /monitors/:id/incidents`, or `null` for the cross-monitor
 * `GET /incidents`. `items` is newest-first.
 */
export const incidentsListResponseSchema = z.object({
  /** The monitor the list is scoped to, or `null` for the cross-monitor list. */
  monitorId: z.uuid().nullable(),
  items: z.array(incidentListItemSchema),
});
export type IncidentsListResponse = z.infer<typeof incidentsListResponseSchema>;

/** Default / max row caps surfaced as constants so the service and the schema
 * agree (the schema is the boundary; these are for code that reads them). */
export const INCIDENTS_LIST_DEFAULT_LIMIT = 20;
export const INCIDENTS_LIST_MAX_LIMIT = 100;
