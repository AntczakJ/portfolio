import { z } from 'zod';

import { monitorStatusSchema } from './events';

/**
 * Check-result schemas (Task 1.4) — the shape the prober records (Phase 2.1)
 * and read endpoints return.
 *
 * `error` is the NORMALISED error class from ADR-002 (never a raw message),
 * so the UI and tests can switch on a stable enum and no raw upstream text
 * leaks to the client.
 */

/** Normalised probe error class (ADR-002). Null when the check was `up`. */
export const checkErrorClassSchema = z.enum([
  'timeout',
  'dns',
  'connection_refused',
  'tls',
  'ssrf_blocked',
  'http_error',
  'keyword_missing',
  'unknown',
]);
export type CheckErrorClass = z.infer<typeof checkErrorClassSchema>;

/**
 * One check result, as written to `check_results` and returned in the
 * recent-checks list.
 */
export const checkResultSchema = z.object({
  id: z.string(),
  monitorId: z.string().uuid(),
  checkedAt: z.string().datetime(),
  status: monitorStatusSchema,
  statusCode: z.number().int().nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  error: checkErrorClassSchema.nullable(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

/**
 * The result the probe runner produces before it is persisted (no id /
 * server-assigned fields yet). Phase 2.1 consumes this; declared now so the
 * write path and the SSE `check.result` payload share a vocabulary.
 */
export const probeOutcomeSchema = z.object({
  status: monitorStatusSchema,
  statusCode: z.number().int().nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
  error: checkErrorClassSchema.nullable(),
});
export type ProbeOutcome = z.infer<typeof probeOutcomeSchema>;
