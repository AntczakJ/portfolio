import { serviceSchema, type Service } from '@/lib/schemas/service';

/**
 * The fixed Razor's Edge menu (ADR-003 / PLAN.md).
 *
 * Hand-curated, NOT random — pricing and durations read as a real menu.
 * Prices are in PLN minor units (grosze). Durations are multiples of the
 * 15-minute slot grid. Combos carry a larger `durationMin` and
 * `category: 'combo'`; that larger duration is the ONLY thing that makes
 * `getAvailability` consume a longer contiguous block (no special case).
 *
 * Validated against `serviceSchema` at module load so a bad row fails loud
 * in dev rather than silently rendering.
 */
const RAW_SERVICES: Service[] = [
  // ── Cuts ────────────────────────────────────────────────────────────
  {
    id: 'svc-signature-cut',
    slug: 'signature-cut',
    name: 'Signature Cut',
    category: 'cut',
    description:
      'A full consultation, precision scissor-and-clipper cut, and a hot-towel finish. The house standard.',
    durationMin: 45,
    priceMinor: 16_000,
    currency: 'PLN',
    popular: true,
  },
  {
    id: 'svc-skin-fade',
    slug: 'skin-fade',
    name: 'Skin Fade',
    category: 'cut',
    description:
      'A seamless fade taken down to the skin, blended by hand and finished sharp.',
    durationMin: 45,
    priceMinor: 17_000,
    currency: 'PLN',
  },
  {
    id: 'svc-buzz-cut',
    slug: 'buzz-cut',
    name: 'Buzz Cut',
    category: 'cut',
    description: 'A single-guard clipper cut, clean and quick, edged crisp.',
    durationMin: 30,
    priceMinor: 9_000,
    currency: 'PLN',
  },
  {
    id: 'svc-restyle',
    slug: 'restyle',
    name: 'Restyle Consultation',
    category: 'cut',
    description:
      'A longer chair for a full change of direction — texture, length, and a look built around you.',
    durationMin: 60,
    priceMinor: 22_000,
    currency: 'PLN',
  },
  // ── Beard ───────────────────────────────────────────────────────────
  {
    id: 'svc-beard-sculpt',
    slug: 'beard-sculpt',
    name: 'Beard Sculpt',
    category: 'beard',
    description:
      'Line-up, shape, and a conditioning finish — your beard rebuilt to its best shape.',
    durationMin: 30,
    priceMinor: 9_000,
    currency: 'PLN',
    popular: true,
  },
  {
    id: 'svc-beard-trim',
    slug: 'beard-trim',
    name: 'Beard Trim & Tidy',
    category: 'beard',
    description: 'A quick clean-up between sculpts — neckline, cheeks, length.',
    durationMin: 15,
    priceMinor: 6_000,
    currency: 'PLN',
  },
  // ── Shave ───────────────────────────────────────────────────────────
  {
    id: 'svc-hot-towel-shave',
    slug: 'hot-towel-shave',
    name: 'Hot-Towel Straight Shave',
    category: 'shave',
    description:
      'The full ritual: hot towels, pre-shave oil, a straight-razor pass, and a cold finish.',
    durationMin: 45,
    priceMinor: 14_000,
    currency: 'PLN',
    popular: true,
  },
  {
    id: 'svc-head-shave',
    slug: 'head-shave',
    name: 'Head Shave',
    category: 'shave',
    description: 'A smooth, close head shave with hot towels and aftercare.',
    durationMin: 30,
    priceMinor: 11_000,
    currency: 'PLN',
  },
  // ── Combos (longer single block) ───────────────────────────────────
  {
    id: 'svc-cut-and-beard',
    slug: 'cut-and-beard',
    name: 'Cut & Beard',
    category: 'combo',
    description:
      'The Signature Cut paired with a full Beard Sculpt in one unhurried chair.',
    durationMin: 75,
    priceMinor: 23_000,
    currency: 'PLN',
    popular: true,
  },
  {
    id: 'svc-cut-and-shave',
    slug: 'cut-and-shave',
    name: 'Cut & Hot-Towel Shave',
    category: 'combo',
    description:
      'A Signature Cut followed by the full hot-towel straight shave ritual.',
    durationMin: 90,
    priceMinor: 27_000,
    currency: 'PLN',
  },
  {
    id: 'svc-the-works',
    slug: 'the-works',
    name: 'The Works',
    category: 'combo',
    description:
      'Cut, beard sculpt, and a hot-towel shave — the complete Razor’s Edge sitting.',
    durationMin: 120,
    priceMinor: 36_000,
    currency: 'PLN',
  },
];

/** The validated, frozen menu. */
export const SERVICES: readonly Service[] = Object.freeze(
  RAW_SERVICES.map((s) => serviceSchema.parse(s)),
);

export function getServiceById(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

export function getServiceBySlug(slug: string): Service | undefined {
  return SERVICES.find((s) => s.slug === slug);
}
