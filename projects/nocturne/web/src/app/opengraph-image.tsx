import { ImageResponse } from 'next/og';

import { posterGradient } from '@/lib/poster/poster-gradient';

/**
 * The designed Open Graph image (Task SEO) — the NOCTURNE wordmark over the
 * luminous-field motif (the default preset's palette), generated at build/edge
 * via next/og (Satori). The same authored-gradient approach as the poster, so
 * the social card matches the in-app still. 1200×630, the standard OG size.
 */
export const runtime = 'nodejs';
export const alt = 'NOCTURNE — a GPU audio-reactive generative particle field';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage(): ImageResponse {
  const g = posterGradient('aurora');
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#06070f',
          backgroundImage: [
            `radial-gradient(900px 560px at 32% 40%, ${g.glowMid}, transparent 62%)`,
            `radial-gradient(640px 520px at 70% 62%, ${g.glowHigh}, transparent 58%)`,
            `radial-gradient(360px 320px at 54% 48%, ${g.spark}, transparent 60%)`,
          ].join(', '),
        }}
      >
        <div
          style={{
            fontSize: 132,
            fontWeight: 700,
            letterSpacing: 24,
            color: '#e7e9f5',
            textShadow: '0 4px 60px rgba(0,0,0,0.55)',
          }}
        >
          NOCTURNE
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 34,
            color: '#a4a9c4',
            letterSpacing: 2,
          }}
        >
          A GPU particle field that breathes with sound
        </div>
      </div>
    ),
    size,
  );
}
