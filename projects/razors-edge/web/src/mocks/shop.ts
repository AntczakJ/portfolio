import { shopInfoSchema, type ShopInfo } from '@/lib/schemas/shop';

/**
 * Shop info (ADR-003 / PLAN.md) — address, opening hours, contact, socials.
 * Hand-curated (not random) so it reads as a real local business and feeds
 * the `HairSalon` JSON-LD (Phase 4/7), the footer, and the static-map pin.
 *
 * The address is a plausible, clearly-fictional Warsaw studio (no real
 * business). Opening hours are the front-of-house hours (distinct from the
 * per-barber working hours that drive availability).
 */
const RAW_SHOP: ShopInfo = {
  name: "Razor's Edge",
  tagline: 'An upscale grooming studio. By appointment.',
  address: {
    street: 'ul. Próżna 12',
    city: 'Warsaw',
    postalCode: '00-107',
    country: 'Poland',
    lat: 52.2349,
    lng: 21.0067,
    mapsUrl: 'https://maps.google.com/?q=Razors+Edge+ul.+Pr%C3%B3%C5%BCna+12+Warsaw',
  },
  phone: '+48 22 555 01 90',
  email: 'studio@razors-edge.demo',
  // Indexed 0 = Sun … 6 = Sat. Closed Mon; long Thu/Fri evenings.
  openingHours: [
    { open: '11:00', close: '16:00' }, // Sun
    null, // Mon — closed
    { open: '10:00', close: '18:00' }, // Tue
    { open: '10:00', close: '18:00' }, // Wed
    { open: '10:00', close: '20:00' }, // Thu
    { open: '10:00', close: '21:00' }, // Fri
    { open: '09:00', close: '16:00' }, // Sat
  ],
  socials: [
    {
      platform: 'instagram',
      handle: '@razorsedge.studio',
      url: 'https://instagram.com/razorsedge.studio',
    },
    {
      platform: 'tiktok',
      handle: '@razorsedge',
      url: 'https://tiktok.com/@razorsedge',
    },
    {
      platform: 'facebook',
      handle: 'razorsedgestudio',
      url: 'https://facebook.com/razorsedgestudio',
    },
  ],
};

/** The validated, frozen shop info. */
export const SHOP: ShopInfo = Object.freeze(shopInfoSchema.parse(RAW_SHOP));
