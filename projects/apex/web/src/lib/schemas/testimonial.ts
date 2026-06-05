import '@/lib/zod-config';

import { z } from 'zod';

import { idSchema } from './common';

/**
 * Testimonial — a seeded client quote (ADR-003 / PLAN.md mock-data shape).
 *
 * `vehicle` optionally references the model the client rented (display only).
 * Seeded with faker but baked to a static file (CSP — ADR-002 §5).
 */
export const testimonialSchema = z.object({
  id: idSchema,
  author: z.string().trim().min(1).max(80),
  /** Author role / location line (e.g. "Weekend driver, Lisbon"). */
  role: z.string().trim().min(1).max(80),
  rating: z.number().int().min(1).max(5),
  quote: z.string().trim().min(1).max(400),
  /** Optional rented-model name for attribution. */
  vehicle: z.string().trim().min(1).max(80).optional(),
});

export type Testimonial = z.infer<typeof testimonialSchema>;

export const testimonialListSchema = z.array(testimonialSchema);
export type TestimonialList = z.infer<typeof testimonialListSchema>;
