import { z } from 'zod';

import { BLUR_PLACEHOLDERS } from './image-placeholders';

/**
 * Gallery / hero photography SLOTS (ADR-004 art-direction slots).
 *
 * The real cinematic photography is wired here as graded, royalty-clear
 * (Unsplash License) source images under `public/images/graded/` — one
 * cohesive dark-luxe treatment applied by `scripts/grade-photography.mjs`
 * so the set reads as a single cinematic frame. `next/image` re-encodes to
 * AVIF/WebP at request time. Each slot carries a real intrinsic aspect
 * ratio (CLS-safe), real `alt` text (SR/SEO floor), and a base64 blur
 * placeholder (no flash on paint). Provenance is in
 * `public/images/CREDITS.md`; the README documents the swap-for-real path.
 */
export const gallerySlotKindSchema = z.enum([
  'hero-desktop', // cinematic landscape crop revealed in the wordmark gap
  'hero-mobile', // tall crop, art-directed for the 320px reveal
  'gallery', // gallery strip frame
]);
export type GallerySlotKind = z.infer<typeof gallerySlotKindSchema>;

export const gallerySlotSchema = z.object({
  slot: z.string().min(1),
  kind: gallerySlotKindSchema,
  /** Path to the graded source `next/image` serves (re-encoded to AVIF). */
  src: z.string().min(1),
  alt: z.string().min(1),
  /** Intrinsic aspect ratio (w/h) so layout reserves space (CLS-safe). */
  aspectRatio: z.number().positive(),
  /** Base64 LQIP blur placeholder (no flash on paint). */
  blurDataURL: z.string().min(1),
  /** Caption for the gallery editorial overlay (optional). */
  caption: z.string().min(1).optional(),
});
export type GallerySlot = z.infer<typeof gallerySlotSchema>;

const RAW: GallerySlot[] = [
  {
    slot: 'hero-desktop',
    kind: 'hero-desktop',
    src: '/images/graded/hero-desktop.jpg',
    alt: 'A client reclined for a straight-razor shave, eyes closed, the barber drawing the blade in low, warm light.',
    aspectRatio: 1920 / 1200,
    blurDataURL: BLUR_PLACEHOLDERS['hero-desktop'],
  },
  {
    slot: 'hero-mobile',
    kind: 'hero-mobile',
    src: '/images/graded/hero-mobile.jpg',
    alt: 'A straight-razor shave in profile — the blade drawn along the jaw under low, warm light.',
    aspectRatio: 1080 / 1440,
    blurDataURL: BLUR_PLACEHOLDERS['hero-mobile'],
  },
  {
    slot: 'gallery-01',
    kind: 'gallery',
    src: '/images/graded/gallery-01.jpg',
    alt: 'The studio interior — brick wall, brass pendants, classic chairs.',
    aspectRatio: 1280 / 1600,
    blurDataURL: BLUR_PLACEHOLDERS['gallery-01'],
    caption: 'The room, after hours',
  },
  {
    slot: 'gallery-02',
    kind: 'gallery',
    src: '/images/graded/gallery-02.jpg',
    alt: 'A barber trimming a reclined client’s beard with scissors under low, warm light.',
    aspectRatio: 1600 / 1067,
    blurDataURL: BLUR_PLACEHOLDERS['gallery-02'],
    caption: 'The beard trim',
  },
  {
    slot: 'gallery-03',
    kind: 'gallery',
    src: '/images/graded/gallery-03.jpg',
    alt: 'A vintage leather barber chair in chrome and low light.',
    aspectRatio: 1600 / 900,
    blurDataURL: BLUR_PLACEHOLDERS['gallery-03'],
    caption: 'The chair',
  },
  {
    slot: 'gallery-04',
    kind: 'gallery',
    src: '/images/graded/gallery-04.jpg',
    alt: 'A textured crop shaped with scissor over comb.',
    aspectRatio: 1280 / 1600,
    blurDataURL: BLUR_PLACEHOLDERS['gallery-04'],
    caption: 'Scissor over comb',
  },
  {
    slot: 'gallery-05',
    kind: 'gallery',
    src: '/images/graded/gallery-05.jpg',
    alt: 'A finish blow-dry at the chair.',
    aspectRatio: 1600 / 1067,
    blurDataURL: BLUR_PLACEHOLDERS['gallery-05'],
    caption: 'The finish',
  },
];

/** All validated, frozen gallery/hero slots. */
export const GALLERY_SLOTS: readonly GallerySlot[] = Object.freeze(
  RAW.map((g) => gallerySlotSchema.parse(g)),
);

export function gallerySlotsByKind(kind: GallerySlotKind): GallerySlot[] {
  return GALLERY_SLOTS.filter((g) => g.kind === kind);
}

function requireSlot(slot: string): GallerySlot {
  const found = GALLERY_SLOTS.find((g) => g.slot === slot);
  if (!found) {
    throw new Error(`Unknown gallery slot: ${slot}`);
  }
  return found;
}

/** The desktop hero portrait — the LCP element (ADR-004). */
export const HERO_DESKTOP: GallerySlot = requireSlot('hero-desktop');
/** The mobile hero portrait — art-directed tall crop for the 320px reveal. */
export const HERO_MOBILE: GallerySlot = requireSlot('hero-mobile');
/** The five gallery frames. */
export const GALLERY_FRAMES: readonly GallerySlot[] =
  gallerySlotsByKind('gallery');
