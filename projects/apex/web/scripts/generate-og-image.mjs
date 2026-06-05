/**
 * generate-og-image.mjs — the social-share (Open Graph / Twitter) card (P1-1).
 *
 * `app/layout.tsx` declares `openGraph` + `twitter: summary_large_image` but
 * shipped NO image, so shares rendered blank. This script composes a branded
 * 1200×630 PNG from the EXISTING flagship studio render (`hero.avif`, a real
 * frame of the configurator car) + an on-brand gradient scrim + the APEX
 * wordmark and tagline, and writes it to `public/og/opengraph.png` (PNG, the
 * universally-supported OG format — not AVIF, which several crawlers skip).
 *
 * It is a build/author-time Node + `sharp` step (NOT a browser path), so the
 * strict CSP does not apply to its generation. The shipped PNG is a same-origin
 * static asset already covered by `img-src 'self'`. No external imagery is
 * fetched, so there is no licensing/IP exposure beyond the already-flagged
 * placeholder GLB the hero render derives from (CREDITS.md).
 *
 * Run: `pnpm -F apex-web og:image`
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

const W = 1200;
const H = 630;

// apex tokens (kept in sync with globals.css — the dark "night drive" register
// reads best for a share card).
const INK = '#e8edf2';
const INK_SOFT = '#9aa6b5';
const ACCENT = '#2ee6a6';
const BG = '#0a0e14';

const HERO_SRC = join(PUBLIC, 'renders', 'lumen-gt', 'hero-dark.avif');
const OUT_DIR = join(PUBLIC, 'og');
const OUT = join(OUT_DIR, 'opengraph.png');

/** The overlay: a left-to-right scrim + the brand lockup + tagline + accent. */
function overlaySvg() {
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${BG}" stop-opacity="0.96"/>
      <stop offset="0.5" stop-color="${BG}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${BG}" stop-opacity="0.12"/>
    </linearGradient>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.6" stop-color="${BG}" stop-opacity="0"/>
      <stop offset="1" stop-color="${BG}" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect width="${W}" height="${H}" fill="url(#bottom)"/>
  <!-- The track-line signature bar. -->
  <rect x="80" y="150" width="64" height="6" rx="3" fill="${ACCENT}"/>
  <!-- Wordmark. -->
  <text x="80" y="250" font-family="'Space Grotesk','Segoe UI',sans-serif" font-size="116" font-weight="700" letter-spacing="6" fill="${INK}">APEX</text>
  <!-- Tagline. -->
  <text x="82" y="320" font-family="'Inter','Segoe UI',sans-serif" font-size="34" font-weight="500" fill="${INK}">Premium electric vehicles, by the day.</text>
  <text x="82" y="368" font-family="'Inter','Segoe UI',sans-serif" font-size="28" font-weight="400" fill="${INK_SOFT}">Configure your car and reserve in minutes.</text>
  <!-- A small accent chip footer. -->
  <circle cx="92" cy="540" r="7" fill="${ACCENT}"/>
  <text x="110" y="548" font-family="'Inter','Segoe UI',sans-serif" font-size="22" font-weight="500" fill="${INK_SOFT}">3D configurator · live reservation</text>
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // The hero render, cover-fit to the card, biased right so the car sits under
  // the lighter edge of the scrim and the copy sits over the dark left.
  const base = await sharp(HERO_SRC)
    .resize(W, H, { fit: 'cover', position: 'right' })
    .toBuffer();

  await sharp(base)
    .composite([{ input: Buffer.from(overlaySvg()), top: 0, left: 0 }])
    .png({ quality: 90 })
    .toFile(OUT);

  console.log(`OG image written: ${OUT} (${W}x${H})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
