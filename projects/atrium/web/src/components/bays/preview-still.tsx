import Image, { type StaticImageData } from 'next/image';
import type { ReactNode } from 'react';

import type { ProjectSlug } from '@/lib/schemas/project';

import apexDark from '@/assets/preview-stills/apex-dark.avif';
import apexLight from '@/assets/preview-stills/apex-light.avif';
import atlasDark from '@/assets/preview-stills/atlas-dark.avif';
import atlasLight from '@/assets/preview-stills/atlas-light.avif';
import meldDark from '@/assets/preview-stills/meld-dark.avif';
import meldLight from '@/assets/preview-stills/meld-light.avif';
import pulseDark from '@/assets/preview-stills/pulse-dark.avif';
import pulseLight from '@/assets/preview-stills/pulse-light.avif';
import razorsEdgeDark from '@/assets/preview-stills/razors-edge-dark.avif';
import razorsEdgeLight from '@/assets/preview-stills/razors-edge-light.avif';
import tapeDark from '@/assets/preview-stills/tape-dark.avif';
import tapeLight from '@/assets/preview-stills/tape-light.avif';

/**
 * PreviewStill — the per-bay PREVIEW STILL (the atrium v2 enrichment; the
 * long-reserved Task 4.5 / ADR-003 `data-bay-media` slot + optional
 * `previewImage` field, now completed).
 *
 * It enriches each bay with a recruiter-legible hero still of the actual
 * showcase, so the tour shows what each project IS at a glance — without ever
 * fighting the now-cleared "lit room" composition (B-01..B-05) or out-ranking the
 * bay title (the D-06 hierarchy lesson).
 *
 * ── ASSETS / NO public/ DIR ─────────────────────────────────────────────────
 * Each still is the portfolio's OWN committed screenshot of that project,
 * cropped to one consistent 16:10 frame + optimised to AVIF by
 * `scripts/optimize-preview-stills.mjs` (provenance there + in
 * `docs/preview-stills-shots/`). They are STATIC-IMPORTED here, so they emit into
 * `.next/static` and atrium stays WITHOUT a `public/` dir (the Dockerfile has no
 * `web/public` COPY — static imports need none). Each `import` is a
 * `StaticImageData` carrying intrinsic `width`/`height`, which lets `next/image`
 * reserve the box and avoid CLS.
 *
 * ── THEME-MATCHED (dark still in dark, light still in light) ─────────────────
 * Both stills render; CSS swaps which is visible against the `.dark` / `.light`
 * class next-themes writes on `<html>` (the same class-strategy the rest of the
 * site themes against). The `:root` is dark-canonical, so the dark still shows on
 * the SSR first paint with no theme flash, and no JS is needed for the swap (it
 * also works under no-JS / the directory floor). The dark/light pair classes live
 * in `globals.css` (`[data-preview-still-dark]` / `[data-preview-still-light]`).
 *
 * ── LIT BY THE BAY HUE, secondary to the title ──────────────────────────────
 * The still sits in a hue-tinted inset frame (a thin `--bay` border + a soft hue
 * glow + a faint top-light sheen) so it reads as a framed plate LIT by the room,
 * not a bare floating rectangle. It is quiet: muted at rest, the frame does the
 * tying-in. It never carries weight that competes with the `<h2>` title.
 *
 * ── NEVER THE LCP · NO CLS · NO MOTION ──────────────────────────────────────
 * `loading="lazy"` (never `priority`) — the hero wordmark stays the LCP. The
 * box is reserved by the static intrinsic ratio (aspect-[16/10]) so it does not
 * shift layout. There is NO GSAP/CSS motion bound to the still itself; it is
 * present and static (the bay's `data-bay-reveal` wrapper handles the one gentle
 * entrance the rest of the bay shares, and that is fully neutralised under
 * reduced motion by the sequence's `reduced` matchMedia branch).
 *
 * SERVER component — pure markup, part of the no-JS / reduced-motion floor.
 */

interface PreviewStillProps {
  slug: ProjectSlug;
  /** The project name — used to build the still's accessible alt text. */
  name: string;
  className?: string;
}

/** The static-imported dark+light AVIF pair per project (emit into .next/static). */
const STILLS: Record<ProjectSlug, { dark: StaticImageData; light: StaticImageData }> = {
  tape: { dark: tapeDark, light: tapeLight },
  meld: { dark: meldDark, light: meldLight },
  'razors-edge': { dark: razorsEdgeDark, light: razorsEdgeLight },
  pulse: { dark: pulseDark, light: pulseLight },
  apex: { dark: apexDark, light: apexLight },
  atlas: { dark: atlasDark, light: atlasLight },
};

/** A tasteful, non-load-bearing alt — the title already names the project. */
function altFor(name: string): string {
  return `Preview of the ${name} showcase`;
}

export function PreviewStill({ slug, name, className }: PreviewStillProps): ReactNode {
  const pair = STILLS[slug];
  const alt = altFor(name);

  // Common props — lazy (never LCP), unoptimized so the already-AVIF static
  // asset is served straight from .next/static (no /_next/image round-trip, no
  // runtime sharp on the Fly machine; img-src 'self' covers it with no CSP
  // change). `sizes` keeps the served box honest across the responsive column.
  const imageProps = {
    width: pair.dark.width,
    height: pair.dark.height,
    loading: 'lazy' as const,
    unoptimized: true,
    draggable: false,
    sizes: '(max-width: 1023px) 100vw, 38vw',
    className: 'h-full w-full object-cover',
  };

  return (
    <figure
      data-preview-still
      className={`group/still relative aspect-[16/10] w-full overflow-hidden rounded-lg ${
        className ?? ''
      }`}
      style={
        {
          // The hue-tinted inset frame + glow that ties the still to the lit room.
          // Thin hue border, a soft outer hue glow, and a faint inner top sheen —
          // all token-driven off the bay's `--bay`, so it holds on both grounds.
          border: '1px solid color-mix(in oklab, var(--bay) 38%, transparent)',
          boxShadow:
            '0 0 0 1px color-mix(in oklab, var(--bay) 10%, transparent), 0 18px 50px -28px color-mix(in oklab, var(--bay) 60%, transparent)',
          background: 'color-mix(in oklab, var(--bay-floor) 18%, var(--color-surface))',
        }
      }
    >
      {/* The theme-matched stills — both rendered, CSS shows one per theme. */}
      <Image
        {...imageProps}
        src={pair.dark}
        alt={alt}
        data-preview-still-dark
        className={`${imageProps.className} block dark:block`}
      />
      <Image
        {...imageProps}
        src={pair.light}
        alt=""
        aria-hidden
        data-preview-still-light
        className={imageProps.className}
      />
      {/* A faint top-light sheen + a thin floor wash, so the plate reads as LIT by
          the room rather than a flat cut-out. aria-hidden decoration. */}
      <span
        aria-hidden
        data-preview-still-sheen
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--bay) 14%, transparent) 0%, transparent 26%, transparent 78%, color-mix(in oklab, var(--bay-floor) 20%, transparent) 100%)',
        }}
      />
    </figure>
  );
}
