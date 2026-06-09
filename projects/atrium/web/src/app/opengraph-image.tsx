import { ImageResponse } from 'next/og';

import { AUTHOR_NAME } from '@/lib/site-config';

/**
 * Open Graph / Twitter card image (Next `opengraph-image` convention ->
 * `/opengraph-image`). The atrium wordmark-in-light composition: the ATRIUM
 * specimen set in light on a near-black warm field, lit by a single warm
 * volumetric shaft from above — the page's first-paint threshold frame,
 * reduced to a still. Backs the `twitter: summary_large_image` declared in
 * `layout.tsx`.
 *
 * Rendered by Satori (`next/og`) at build/request time; the layout is a
 * flexbox subset, so the composition is expressed with plain inline styles
 * rather than the app's Tailwind tokens. The colours are sRGB-hex
 * approximations of the sovereign OKLCH palette (the warm near-black
 * `--color-bg` field, the neutral-warm `--color-light` accent / `--shaft-*`
 * beam, the `--color-fg` ink). No webfont fetch: Satori falls back to its
 * built-in sans, which carries the structural-grotesque register well enough
 * at this size.
 *
 * CSP note: this route emits a PNG, not script — it runs server-side under
 * `runtime = 'nodejs'` and does not execute in the page, so the strict
 * no-`unsafe-eval` CSP is irrelevant to it.
 */
export const runtime = 'nodejs';

export const alt =
  'ATRIUM — the portfolio of Jan Antczak. Six showcases, four backends, one quality bar.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Sovereign-palette approximations in sRGB hex (Satori needs concrete colours,
// not the OKLCH CSS variables). Mirrors globals.css :root (dark canonical).
const FIELD_TOP = '#1a1714'; // --field-top (warm near-black, top of the hall)
const FIELD_BOTTOM = '#242019'; // --field-bottom (warm charcoal floor)
const NEAR_BLACK = '#13110e'; // deepest vignette
const FG = '#f1ece2'; // --color-fg (warm bone ink)
const FG_MUTED = '#b4ab99'; // --color-fg-muted
const LIGHT = '#f0e3c4'; // --color-light (neutral-warm wordmark glow)
const LIGHT_STRONG = '#fbf3df'; // --color-light-strong (the lit shaft core)

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          background: `linear-gradient(180deg, ${FIELD_TOP} 0%, ${FIELD_BOTTOM} 100%)`,
          fontFamily: 'sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* The warm volumetric shaft — a soft beam raking down from the top
            centre, lighting the wordmark as if by an overhead light well. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            width: 760,
            height: '100%',
            transform: 'translateX(-50%)',
            background: `radial-gradient(70% 55% at 50% 12%, ${LIGHT_STRONG}33 0%, ${LIGHT}1f 30%, transparent 62%)`,
            display: 'flex',
          }}
        />
        {/* Framing vignette so the field reads as a deep space, not a flat fill. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(120% 120% at 50% 38%, transparent 46%, ${NEAR_BLACK} 100%)`,
            display: 'flex',
          }}
        />

        {/* Eyebrow + lit rule. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            marginBottom: 48,
          }}
        >
          <div
            style={{
              width: 56,
              height: 2,
              background: LIGHT_STRONG,
              boxShadow: `0 0 18px ${LIGHT}`,
            }}
          />
          <div
            style={{
              color: LIGHT,
              fontSize: 24,
              letterSpacing: 10,
              textTransform: 'uppercase',
            }}
          >
            {`The portfolio of ${AUTHOR_NAME}`}
          </div>
          <div
            style={{
              width: 56,
              height: 2,
              background: LIGHT_STRONG,
              boxShadow: `0 0 18px ${LIGHT}`,
            }}
          />
        </div>

        {/* The ATRIUM wordmark — the specimen, lit. */}
        <div
          style={{
            display: 'flex',
            fontSize: 220,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: 6,
            color: FG,
            textShadow: `0 0 64px ${LIGHT}55`,
          }}
        >
          ATRIUM
        </div>

        {/* Supporting line. */}
        <div
          style={{
            display: 'flex',
            marginTop: 44,
            color: FG_MUTED,
            fontSize: 32,
            letterSpacing: 1,
          }}
        >
          Six showcases · four backends · one quality bar
        </div>
      </div>
    ),
    size,
  );
}
