import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface StudioMapProps {
  className?: string;
  /** Accessible label for the map figure. */
  label: string;
}

/**
 * Studio map treatment (Task 4.4 — D-06 rework). A CSP-clean, same-origin,
 * dark-styled illustrated map motif. NO Google Maps / Mapbox JS, NO API key,
 * NO external tile request: an inline SVG of the studio's quarter rendered in
 * the brand's monochrome brass-on-near-black world, so it stays inside the
 * strict CSP (`default-src 'self'`) and the performance budget.
 *
 * D-06 (it read like a broken placeholder before): the map now has real
 * intent — a deliberate old-town street layout with named streets (Próżna,
 * Złota, the cross-streets and the little square the studio sits on), a clear
 * river/park edge, a brass EDGE-GLOW pin that lights its block, and the
 * studio block tinted up so the eye lands on it. It themes via the design
 * tokens, and `.studio-map` carries a distinct LIGHT-theme stroke treatment
 * (see globals.css) so the light register is its own considered asset, not
 * the dark strokes on paper.
 *
 * It is decorative (`role="img"` + a label); the real interaction is the
 * "Open in Maps" click-through in the parent. The grid is a stylised
 * abstraction of the fictional address — it reads as "a studio, here in the
 * old town" without pretending to be survey-accurate.
 */
export function StudioMap({ className, label }: StudioMapProps): ReactNode {
  return (
    <svg
      viewBox="0 0 400 300"
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid slice"
      className={cn('studio-map h-full w-full', className)}
    >
      <defs>
        <radialGradient id="map-field" cx="56%" cy="42%" r="78%">
          <stop offset="0%" stopColor="var(--map-field-near)" />
          <stop offset="100%" stopColor="var(--map-field-far)" />
        </radialGradient>
        <filter id="map-pin-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Field. */}
      <rect width="400" height="300" fill="url(#map-field)" />

      {/* A park / green wedge in the lower-left corner (the old-town edge). */}
      <path
        d="M0 235 C70 222 120 250 150 300 L0 300 Z"
        fill="var(--map-park)"
      />

      {/* ── Secondary streets (thin) ──────────────────────────────────── */}
      <g
        stroke="var(--map-street)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      >
        <path d="M0 60 H400" />
        <path d="M0 210 H400" />
        <path d="M110 0 V300" />
        <path d="M300 0 V300" />
        {/* An angled lane through the quarter. */}
        <path d="M110 140 L210 230" />
        <path d="M210 60 L300 0" />
      </g>

      {/* ── Primary avenues (thicker, brighter) ───────────────────────── */}
      <g
        stroke="var(--map-avenue)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      >
        {/* Próżna runs across; Złota crosses it by the studio. */}
        <path d="M0 140 H400" />
        <path d="M210 0 V300" />
      </g>

      {/* The block the studio sits on — a faintly lit raised surface. */}
      <rect
        x="120"
        y="68"
        width="84"
        height="64"
        rx="2"
        fill="var(--map-block)"
      />

      {/* ── Street labels — give the map real intent ──────────────────── */}
      <g
        fill="var(--map-label)"
        fontSize="9"
        letterSpacing="1.4"
        fontFamily="var(--font-sans)"
      >
        <text x="14" y="134" opacity="0.9">
          PRÓŻNA
        </text>
        <text
          x="216"
          y="206"
          opacity="0.75"
          transform="rotate(90 216 206)"
        >
          ZŁOTA
        </text>
        <text x="316" y="54" opacity="0.6">
          MARSZAŁKOWSKA
        </text>
      </g>

      {/* ── Brass location pin lighting its block ─────────────────────── */}
      <g transform="translate(170 100)">
        <circle
          r="22"
          fill="var(--color-edge-glow)"
          opacity="0.22"
          filter="url(#map-pin-glow)"
        />
        {/* Teardrop pin. */}
        <path
          d="M0 -19 C8.8 -19 16 -12 16 -3.2 C16 7.4 0 19 0 19 C0 19 -16 7.4 -16 -3.2 C-16 -12 -8.8 -19 0 -19 Z"
          fill="var(--color-brass)"
          stroke="var(--color-edge-glow)"
          strokeWidth="1"
        />
        <circle r="5.2" cy="-3.2" fill="var(--color-on-brass)" />
      </g>
    </svg>
  );
}
