import { ImageResponse } from 'next/og';

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site-config';

/**
 * Root OG image (Task 6.3) — generated at build/request time with `next/og`.
 *
 * A control-room dark card with the wordmark + pitch line, rendered to a 1200x630
 * PNG. No external fonts/assets (the satori renderer uses system-style stacks),
 * so it is fully self-contained and CSP-clean. Reused as the social card for the
 * root and (via the about route's own image) the landing.
 */

export const runtime = 'nodejs';
export const alt = `${SITE_NAME} — live fleet operations`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0b1018 0%, #121a26 60%, #18222f 100%)',
          padding: '72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '14px',
              background: 'rgba(246, 168, 33, 0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f6a821',
              fontSize: '30px',
              fontWeight: 700,
              letterSpacing: '-0.04em',
            }}
          >
            ATL
          </div>
          <div style={{ color: '#e6ecf3', fontSize: '40px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            {SITE_NAME}
          </div>
          <div
            style={{
              color: '#97a4b6',
              fontSize: '20px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginTop: '8px',
            }}
          >
            Fleet Operations
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              color: '#e6ecf3',
              fontSize: '60px',
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.025em',
              maxWidth: '960px',
            }}
          >
            A live operations map where the fleet moves in real time.
          </div>
          <div style={{ color: '#97a4b6', fontSize: '26px', lineHeight: 1.4, maxWidth: '900px' }}>
            {SITE_DESCRIPTION}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              height: '4px',
              width: '120px',
              background: 'linear-gradient(90deg, #f6a821 0%, rgba(246,168,33,0) 100%)',
              borderRadius: '2px',
            }}
          />
          <div style={{ color: '#6f7e93', fontSize: '20px', fontFamily: 'monospace' }}>
            Fastify · WebSocket · MapLibre · deterministic simulation
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
