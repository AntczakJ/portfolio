import { ImageResponse } from 'next/og';

import {
  getPublicStatusPage,
  PublicStatusError,
} from '@/lib/api/public-status';
import {
  openIncidentCount,
  overallBanner,
} from '@/lib/public-status/public-status-view';

/**
 * The Open Graph image for a public status page (Task 6.6, `next/og`).
 *
 * On-brand: the Pulse indigo + the status color of the overall state, the
 * service name, and the headline ("All systems operational" / "Active outage").
 * Rendered at the edge from the redacted `GET /public/:slug` payload — so a
 * shared link (Slack / X / etc.) previews the CURRENT operational state, which
 * is exactly the thing a status link is shared to convey.
 *
 * The colors are inlined (the `ImageResponse` runtime cannot read the CSS-var
 * tokens), but they are the same sovereign palette values from globals.css so
 * the OG card reads as one design language with the page.
 */

export const runtime = 'nodejs';
export const alt = 'Status page';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Inlined from the sovereign tokens (globals.css) — the OG runtime cannot read
// CSS vars. Dark surface (the premium register) + the status accents.
const BG = '#0c0d12';
const FG = '#f7f8fb';
const FG_MUTED = '#a6abbd';
const BRAND = '#8b9cff';
const STATUS = {
  up: '#5fd08a',
  degraded: '#f0c24b',
  down: '#f07a76',
} as const;

export default async function OgImage({
  params,
}: {
  params: { slug: string };
}): Promise<ImageResponse> {
  const { slug } = params;

  let title = 'Status';
  let headline = 'Operational status';
  let tone: 'up' | 'degraded' | 'down' = 'up';

  try {
    const page = await getPublicStatusPage(slug);
    const banner = overallBanner(page.overall, openIncidentCount(page));
    title = page.title;
    headline = banner.headline;
    tone = banner.tone;
  } catch (error) {
    if (!(error instanceof PublicStatusError)) {
      throw error;
    }
    // 404 / unreachable -> a neutral generic card (still on-brand).
  }

  const accent = STATUS[tone];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: BG,
          padding: '72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: BRAND,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke={BG}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 12h4l2.5-6 4 13 2.5-7H22" />
            </svg>
          </div>
          <span style={{ fontSize: '34px', color: FG, fontWeight: 600 }}>
            Pulse
          </span>
        </div>

        {/* Status block */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '999px',
                background: accent,
              }}
            />
            <span style={{ fontSize: '40px', color: accent, fontWeight: 600 }}>
              {headline}
            </span>
          </div>
          <span
            style={{
              fontSize: '72px',
              color: FG,
              fontWeight: 700,
              lineHeight: 1.05,
            }}
          >
            {title}
          </span>
        </div>

        {/* Footer */}
        <span style={{ fontSize: '26px', color: FG_MUTED }}>
          Live uptime status, pushed over SSE
        </span>
      </div>
    ),
    size,
  );
}
