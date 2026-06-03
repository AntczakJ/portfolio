import { z } from 'zod';

import { hhmmSchema } from './common';

/** A single social link (icon resolved from the platform in the UI). */
export const socialLinkSchema = z.object({
  platform: z.enum(['instagram', 'facebook', 'tiktok', 'x', 'youtube']),
  handle: z.string().min(1),
  url: z.url(),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

/** A public opening-hours row (the studio front-of-house hours, distinct
 * from per-barber working hours). `null` = closed that weekday. */
export const openingHoursRowSchema = z
  .object({
    open: hhmmSchema,
    close: hhmmSchema,
  })
  .nullable();

/**
 * Shop info (ADR-003 / PLAN.md). Address, opening hours, contact, socials —
 * also the source for the `HairSalon` JSON-LD (Phase 4/7) and the footer.
 */
export const shopInfoSchema = z.object({
  name: z.string().min(1),
  tagline: z.string().min(1),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1),
    /** For the static-map pin + maps click-through (no live embed). */
    lat: z.number(),
    lng: z.number(),
    mapsUrl: z.url(),
  }),
  phone: z.string().min(1),
  email: z.email(),
  /** Indexed 0 = Sunday … 6 = Saturday (matches WeeklySchedule). */
  openingHours: z.tuple([
    openingHoursRowSchema,
    openingHoursRowSchema,
    openingHoursRowSchema,
    openingHoursRowSchema,
    openingHoursRowSchema,
    openingHoursRowSchema,
    openingHoursRowSchema,
  ]),
  socials: z.array(socialLinkSchema),
});
export type ShopInfo = z.infer<typeof shopInfoSchema>;
