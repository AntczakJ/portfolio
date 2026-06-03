import { z } from 'zod';

/**
 * Contact details collected in the wizard "Your details" step (ADR-003).
 * The form (react-hook-form + zodResolver) and the mocked submit share
 * this schema. No real PII leaves the device (web-only thesis).
 */
export const contactDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Please enter your name')
    .max(80, 'Name is too long'),
  phone: z
    .string()
    .trim()
    .min(6, 'Please enter a valid phone number')
    .max(24, 'Phone number is too long')
    // Permissive international-ish phone: digits, spaces, +, -, ().
    .regex(/^[+()0-9 -]+$/, 'Only digits, spaces and + ( ) -'),
  email: z
    .string()
    .trim()
    .min(1, 'Please enter your email')
    // Trim first, then validate the email format (Zod 4 top-level `z.email`).
    .pipe(z.email('Please enter a valid email')),
  notes: z.string().trim().max(500, 'Notes are too long').optional(),
});

export type ContactDetails = z.infer<typeof contactDetailsSchema>;
