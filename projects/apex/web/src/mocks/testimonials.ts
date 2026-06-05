import {
  testimonialListSchema,
  type Testimonial,
} from '@/lib/schemas/testimonial';

import { SEED_TESTIMONIALS } from './seed-data';

/** Testimonials mock accessor (Task 3.2). Parsed once through the schema. */
export const TESTIMONIALS: readonly Testimonial[] = testimonialListSchema.parse(
  SEED_TESTIMONIALS,
);
