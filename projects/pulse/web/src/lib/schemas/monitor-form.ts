import '@/lib/zod-config';

import { z } from 'zod';

import type { CreateMonitorInput } from 'pulse-server';

/**
 * The create-monitor FORM schema (web mirror of the server's
 * `createMonitorSchema`, conventions § 5).
 *
 * Ideally the SAME Zod object is imported on both sides; here the server
 * pins Zod v3 and the web is on Zod v4, so importing the server's runtime
 * object would drag a second Zod version into the browser bundle. Instead we
 * import the inferred INPUT TYPE (`CreateMonitorInput`) types-only and mirror
 * the validation with the web's Zod, then pin the resolved output to the
 * contract via `satisfies` — if the server's create contract changes shape,
 * the type drifts and this file fails to compile (the drift guard).
 *
 * Bounds mirror the server schema exactly (interval 30s..1d, timeout
 * 1s..30s, status 100..599, thresholds 1..20). The SSRF guard is a SERVER
 * concern (it resolves DNS) — the form only validates shape, and a target
 * the server rejects surfaces as a 400 the dialog shows inline.
 */
export const monitorFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  targetUrl: z
    .string()
    .trim()
    .min(1, 'Target URL is required')
    .max(2048, 'Target URL is too long')
    .pipe(z.url('Enter a valid absolute URL'))
    .refine(
      (raw) => {
        try {
          const scheme = new URL(raw).protocol;
          return scheme === 'http:' || scheme === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Use the http or https scheme' },
    ),
  intervalSeconds: z.coerce
    .number()
    .int()
    .min(30, 'Minimum interval is 30 seconds')
    .max(86_400, 'Maximum interval is 1 day'),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(1_000, 'Minimum timeout is 1000 ms')
    .max(30_000, 'Maximum timeout is 30000 ms'),
  expectedStatus: z.coerce
    .number()
    .int()
    .min(100)
    .max(599, 'Enter a valid HTTP status code'),
  expectedKeyword: z
    .string()
    .trim()
    .max(256)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  isPublic: z.boolean(),
});

export type MonitorFormOutput = z.output<typeof monitorFormSchema>;

/**
 * The form's working value type. Hand-written (not `z.input`) because
 * `z.coerce.number()` infers an `unknown` input, which fights both
 * react-hook-form's field typing and the resolver. Number fields are typed
 * `number` here; the `<input type="number">` + RHF + the zod coercion handle
 * the string-from-DOM -> number conversion at submit. This is the
 * conventions § 5 contract on the validated OUTPUT side; the form shape is a
 * thin DOM-facing view of it.
 */
export interface MonitorFormValues {
  name: string;
  targetUrl: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number;
  expectedKeyword: string;
  isPublic: boolean;
}

/** Sensible defaults for a new monitor (a 60s HTTP GET expecting 200). */
export const MONITOR_FORM_DEFAULTS: MonitorFormValues = {
  name: '',
  targetUrl: '',
  intervalSeconds: 60,
  timeoutMs: 10_000,
  expectedStatus: 200,
  expectedKeyword: '',
  isPublic: false,
};

/**
 * Map the validated form output onto the API create body. Pinned to the
 * shared `CreateMonitorInput` so the request shape cannot drift from the
 * server's contract.
 */
export function toCreateMonitorInput(
  values: MonitorFormOutput,
): CreateMonitorInput {
  return {
    name: values.name,
    targetUrl: values.targetUrl,
    method: 'GET',
    intervalSeconds: values.intervalSeconds,
    timeoutMs: values.timeoutMs,
    expectedStatus: values.expectedStatus,
    expectedKeyword: values.expectedKeyword,
    degradedThresholdMs: 1_000,
    failureThreshold: 3,
    recoveryThreshold: 2,
    isPublic: values.isPublic,
    isPaused: false,
  } satisfies CreateMonitorInput;
}
