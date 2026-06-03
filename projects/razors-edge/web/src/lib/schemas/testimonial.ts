import { z } from 'zod';

/**
 * Testimonial (ADR-003 / PLAN.md mock-data shape). Presented editorially,
 * not as a star-rating dump — `rating` exists for structured data / sort,
 * not necessarily a row of stars in the UI.
 */
export const testimonialSchema = z.object({
  id: z.string().min(1),
  author: z.string().min(1),
  /** 1–5; the curated set sits high (a luxe studio's reviews). */
  rating: z.number().int().min(1).max(5),
  quote: z.string().min(1),
  /** Optional reference to the service the quote is about (flavour). */
  service: z.string().min(1).optional(),
});

export type Testimonial = z.infer<typeof testimonialSchema>;
