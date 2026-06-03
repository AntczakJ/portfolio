import { z } from 'zod';

import {
  hhmmSchema,
  isoDateSchema,
  minuteOfDaySchema,
  serviceCategorySchema,
} from './common';

/**
 * A single working day window. `null` = the studio/barber is closed that
 * weekday. Drives slot generation in `getAvailability`.
 */
export const dayScheduleSchema = z
  .object({
    open: hhmmSchema,
    close: hhmmSchema,
  })
  .nullable();
export type DaySchedule = z.infer<typeof dayScheduleSchema>;

/**
 * Per-weekday schedule, indexed 0 = Sunday … 6 = Saturday to match
 * `Date.getUTCDay()` / `weekdayOfISODate`. A 7-tuple so every weekday is
 * explicit (no missing-key ambiguity).
 */
export const weeklyScheduleSchema = z.tuple([
  dayScheduleSchema, // 0 Sun
  dayScheduleSchema, // 1 Mon
  dayScheduleSchema, // 2 Tue
  dayScheduleSchema, // 3 Wed
  dayScheduleSchema, // 4 Thu
  dayScheduleSchema, // 5 Fri
  dayScheduleSchema, // 6 Sat
]);
export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

/** A daily lunch break that carves a hole in availability (ADR-003). */
export const lunchBreakSchema = z.object({
  startMin: minuteOfDaySchema,
  durationMin: z.number().int().positive().max(4 * 60),
});
export type LunchBreak = z.infer<typeof lunchBreakSchema>;

/**
 * A barber portrait reference (Phase 4.3 — real, graded photography).
 *
 * The graded, royalty-clear (Unsplash License) portrait `next/image` serves
 * (re-encoded to AVIF/WebP), plus a base64 blur placeholder (no flash on
 * paint) and the intrinsic aspect ratio (CLS-safe). Real `alt` is DOM for
 * SR/SEO regardless of which image is wired. Provenance is in
 * `public/images/CREDITS.md`; the README documents the swap-for-real path.
 */
export const portraitSlotSchema = z.object({
  /** Stable slot id the asset pipeline maps to a real file. */
  slot: z.string().min(1),
  /** Path to the graded source `next/image` serves (re-encoded to AVIF). */
  src: z.string().min(1),
  /** Alt text — real DOM for SR/SEO regardless of which image is wired. */
  alt: z.string().min(1),
  /** Intrinsic aspect ratio (w/h) so layout reserves space (CLS-safe). */
  aspectRatio: z.number().positive(),
  /** Base64 LQIP blur placeholder (no flash on paint). */
  blurDataURL: z.string().min(1),
});
export type PortraitSlot = z.infer<typeof portraitSlotSchema>;

/**
 * Barber (ADR-003). A barber offers a service iff `service.category ∈
 * specialties`. `workingHours` − `daysOff` − `lunch` − seeded pre-bookings
 * compose into availability.
 */
export const barberSchema = z.object({
  id: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'kebab-case slug'),
  name: z.string().min(1),
  handle: z
    .string()
    .min(1)
    .regex(/^@[a-z0-9_.]+$/, 'handle like @name'),
  title: z.string().min(1),
  bio: z.string().min(1),
  specialties: z.array(serviceCategorySchema).min(1),
  /** Which concrete services this barber performs (subset of the menu). */
  serviceIds: z.array(z.string().min(1)).min(1),
  portrait: portraitSlotSchema,
  workingHours: weeklyScheduleSchema,
  /** Studio-local ISO dates this barber is off (holiday, etc.). */
  daysOff: z.array(isoDateSchema),
  lunch: lunchBreakSchema.optional(),
});

export type Barber = z.infer<typeof barberSchema>;
