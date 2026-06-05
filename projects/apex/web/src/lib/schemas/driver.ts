import '@/lib/zod-config';

import { z } from 'zod';

/**
 * Driver — the wizard step-4 contact/driver details (ADR-003).
 *
 * Format-validated ONLY (no real verification — PLAN.md out-of-scope, the demo
 * collects no real PII and persists nothing server-side). The licence number is
 * a permissive alphanumeric format check, not a real DVLA/DMV pattern. Inputs
 * are trimmed; the schema is shared by the RHF form step and the mocked submit.
 */
export const driverSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Please enter the full name')
    .max(80)
    .regex(/^[\p{L}][\p{L}\p{M}'.\- ]*$/u, 'Please enter a valid name'),
  email: z.email('Please enter a valid email address').max(160),
  phone: z
    .string()
    .trim()
    .min(6, 'Please enter a valid phone number')
    .max(24)
    .regex(/^[+]?[\d\s().-]{6,24}$/, 'Please enter a valid phone number'),
  /** Driving-licence number — FORMAT only (5–20 alphanumerics, no real check). */
  licenceNo: z
    .string()
    .trim()
    .min(5, 'Licence number looks too short')
    .max(20)
    .regex(/^[A-Za-z0-9]{5,20}$/, 'Letters and numbers only'),
  /** Optional free-text note (special requests). */
  notes: z.string().trim().max(500).optional(),
});

export type Driver = z.infer<typeof driverSchema>;
