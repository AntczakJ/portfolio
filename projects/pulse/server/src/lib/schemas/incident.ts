import { z } from 'zod';

import { incidentSeveritySchema } from './events';

/**
 * Incident schemas (Task 1.4) — the read shape for the live incident row and
 * the incident history (ADR-004). The state machine itself is Phase 5.1; this
 * is just the wire contract.
 */

export const incidentStatusSchema = z.enum(['open', 'resolved']);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const incidentResponseSchema = z.object({
  id: z.uuid(),
  monitorId: z.uuid(),
  status: incidentStatusSchema,
  severity: incidentSeveritySchema,
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  cause: z.string(),
});
export type IncidentResponse = z.infer<typeof incidentResponseSchema>;
