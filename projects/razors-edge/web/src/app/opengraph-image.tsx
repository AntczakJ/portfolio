import { ImageResponse } from 'next/og';

/**
 * Open Graph / Twitter card image (Next `opengraph-image` convention →
 * `/opengraph-image`). An on-brand dark-luxe frame: the RAZOR'S EDGE
 * wordmark + tagline in brass on near-black, with a lit honed-edge rule —
 * backing the `twitter: summary_large_image` declared in `layout.tsx`.
 *
 * Rendered at build/request time by Satori (`next/og`); the layout is a
 * flexbox subset, so the composition is expressed with plain inline styles
 * rather than the app's Tailwind tokens. The colours mirror the sovereign
 * palette (warm near-black ground, brass `#c9a227`-family accent).
 */
export const runtime = 'nodejs';

export const alt =
  "Razor's Edge — an upscale grooming studio, by appointment";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Sovereign-palette approximations in sRGB hex (Satori needs concrete
// colours, not the OKLCH CSS variables).
const NEAR_BLACK = '#0f0c08';
const NEAR_BLACK_2 = '#171108';
const BRASS = '#cB9B45';
const BRASS_BRIGHT = '#e9c66e';
const FG = '#f3ede1';
const FG_MUTED = '#b8ad99';

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: `radial-gradient(120% 120% at 50% 0%, ${NEAR_BLACK_2} 0%, ${NEAR_BLACK} 60%)`,
          padding: '72px 88px',
          fontFamily: 'serif',
        }}
      >
        {/* Top eyebrow + lit rule. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 2,
              background: BRASS_BRIGHT,
              boxShadow: `0 0 16px ${BRASS_BRIGHT}`,
            }}
          />
          <div
            style={{
              color: BRASS,
              fontSize: 24,
              letterSpacing: 8,
              textTransform: 'uppercase',
              fontFamily: 'sans-serif',
            }}
          >
            Warsaw · by appointment
          </div>
        </div>

        {/* Wordmark. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 168,
              lineHeight: 1,
              color: FG,
              letterSpacing: -2,
            }}
          >
            RAZOR’S
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 32,
            }}
          >
            <div
              style={{
                fontSize: 168,
                lineHeight: 1,
                color: BRASS_BRIGHT,
                letterSpacing: -2,
              }}
            >
              EDGE
            </div>
            <div
              style={{
                flex: 1,
                height: 3,
                marginBottom: 24,
                background: `linear-gradient(90deg, ${BRASS} 0%, ${BRASS_BRIGHT} 100%)`,
                boxShadow: `0 0 24px ${BRASS_BRIGHT}`,
              }}
            />
          </div>
        </div>

        {/* Tagline. */}
        <div
          style={{
            color: FG_MUTED,
            fontSize: 34,
            fontFamily: 'sans-serif',
            maxWidth: 820,
          }}
        >
          An upscale grooming studio. Cuts, shaves, and beard work — the chair
          is yours for the hour you book.
        </div>
      </div>
    ),
    size,
  );
}
