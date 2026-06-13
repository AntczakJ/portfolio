import { z } from 'zod';

import { monitorStatusSchema } from './events';

/**
 * Monitor schemas (Task 1.4) — the shared FE/BE contract per conventions § 5.
 *
 * The same `createMonitorSchema` validates the create-monitor form on the
 * web side and the `POST /monitors` body on the server. `monitorResponse`
 * is the shape every monitor read endpoint returns.
 *
 * Field set follows ADR-005 (the `monitors` table) and ADR-002/ADR-004
 * (interval / timeout / thresholds the scheduler + incident engine read).
 */

/** Supported probe methods. v1 is HTTP/HTTPS GET/HEAD; the schema is ready
 * for more without a reshape. TCP/ping is a documented v2 stretch. */
export const monitorMethodSchema = z.enum(['GET', 'HEAD']);
export type MonitorMethod = z.infer<typeof monitorMethodSchema>;

/**
 * Interval bounds (seconds). Floor 30 s keeps a single monitor from
 * hammering a target and bounds raw-row volume (ADR-005 retention math);
 * ceiling 1 day is plenty for v1.
 */
const INTERVAL_MIN_SECONDS = 30;
const INTERVAL_MAX_SECONDS = 86_400;

/** Timeout bounds (ms). Cap 30 s mirrors ADR-002's per-attempt cap. */
const TIMEOUT_MIN_MS = 1_000;
const TIMEOUT_MAX_MS = 30_000;

/**
 * The target URL is validated here at the SHAPE level only (string + URL +
 * http/https scheme). The SSRF guard (`assertProbeUrlAllowed`, ADR-002) is a
 * SEPARATE, security-critical check the controller runs on top of this — it
 * resolves DNS and checks every IP against the denylist, which a Zod schema
 * cannot do. Do not treat passing this schema as "the URL is safe to probe".
 */
export const probeUrlSchema = z
  .string()
  .trim()
  .min(1, 'target URL is required')
  .max(2048, 'target URL is too long')
  .pipe(z.url('target URL must be a valid absolute URL'))
  .refine(
    (raw) => {
      try {
        const scheme = new URL(raw).protocol;
        return scheme === 'http:' || scheme === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'target URL must use the http or https scheme' },
  );

/**
 * Fields a client may set on create. The scheduler-facing fields
 * (interval/timeout/thresholds) carry defaults so a minimal create body
 * (name + url) is valid; the worker re-reads these at run time (ADR-002).
 */
export const createMonitorSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  targetUrl: probeUrlSchema,
  method: monitorMethodSchema.default('GET'),
  intervalSeconds: z.coerce
    .number()
    .int()
    .min(INTERVAL_MIN_SECONDS)
    .max(INTERVAL_MAX_SECONDS)
    .default(60),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(TIMEOUT_MIN_MS)
    .max(TIMEOUT_MAX_MS)
    .default(10_000),
  expectedStatus: z.coerce.number().int().min(100).max(599).default(200),
  expectedKeyword: z.string().trim().min(1).max(256).nullable().default(null),
  degradedThresholdMs: z.coerce
    .number()
    .int()
    .min(1)
    .max(TIMEOUT_MAX_MS)
    .default(1_000),
  failureThreshold: z.coerce.number().int().min(1).max(20).default(3),
  recoveryThreshold: z.coerce.number().int().min(1).max(20).default(2),
  isPublic: z.boolean().default(false),
  isPaused: z.boolean().default(false),
});
export type CreateMonitorInput = z.input<typeof createMonitorSchema>;
export type CreateMonitor = z.infer<typeof createMonitorSchema>;

/**
 * Update is a partial of the create shape (PATCH semantics). At least one
 * field must be present so an empty PATCH is a 400, not a no-op.
 */
export const updateMonitorSchema = createMonitorSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateMonitor = z.infer<typeof updateMonitorSchema>;

/** The canonical monitor read shape returned by every monitor endpoint. */
export const monitorResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetUrl: z.string(),
  method: monitorMethodSchema,
  intervalSeconds: z.number().int(),
  timeoutMs: z.number().int(),
  expectedStatus: z.number().int(),
  expectedKeyword: z.string().nullable(),
  degradedThresholdMs: z.number().int(),
  failureThreshold: z.number().int(),
  recoveryThreshold: z.number().int(),
  isPublic: z.boolean(),
  isPaused: z.boolean(),
  // Derived live status + last-probe timestamp (Phase 2 migration 0001).
  // `currentStatus` is NULL until the monitor's first probe records a result —
  // a null reads as the ADR-004 `unknown`/never-checked state on the board.
  // Serialising these here (Phase 4.1) means a fresh page load / reload paints
  // the persisted status instantly instead of showing `unknown` for ~1 interval
  // until the SSE stream corrects it.
  currentStatus: monitorStatusSchema.nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MonitorResponse = z.infer<typeof monitorResponseSchema>;
