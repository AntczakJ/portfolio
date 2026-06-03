import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The straight / cut-throat razor (ADR-004 layer 4, technique B1) — inline
 * SVG, redrawn (D-02 third rework) to read UNMISTAKABLY as an OPEN folding
 * straight razor in ~200ms, not a pen/stick. The previous draw failed
 * because the handle, pivot, tang, and blade were all COLLINEAR on one
 * horizontal axis — which is exactly what makes a straight razor read as a
 * rod. The fix follows a real open-razor silhouette:
 *
 *   - The HANDLE / SCALES drop AWAY from the blade at a clear open ANGLE
 *     (~32°) off the pivot — the blade and handle are NOT collinear. This
 *     open "V" between the lit blade above and the dark handle below is the
 *     single most recognisable cue of an open cut-throat razor.
 *   - A brass PIVOT/COLLAR sits at the hinge where the two meet.
 *   - The TANG carries the classic crescent THUMB-NOTCH.
 *   - The BLADE runs nearly level with a clear thick SPINE along the TOP
 *     (the brushed-metal band) and the lit honed cutting EDGE along the
 *     BOTTOM (amber `--color-edge-glow`) — the line that does the incision.
 *
 * The whole prop is staged so the lit edge sits on the wordmark's horizontal
 * cut line as it sweeps. Sharp at any width, themeable via the
 * `--color-blade-*` / brass tokens, animated purely by transforms. The amber
 * edge-glow that tracks the leading point is a separate hero layer.
 *
 * Decorative (`aria-hidden`); the hero's meaning is carried by the real-DOM
 * wordmark and the portrait `alt`.
 */
interface BladeProps {
  className?: string;
}

export function Blade({ className }: BladeProps): ReactNode {
  return (
    <svg
      viewBox="0 0 480 160"
      fill="none"
      aria-hidden="true"
      className={cn('h-auto w-full overflow-visible', className)}
    >
      <defs>
        {/* Brushed-metal blade face: dark spine shadow → bright specular
            band along the middle → toward the honed edge. */}
        <linearGradient id="re-blade-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-blade-shadow)" />
          <stop offset="30%" stopColor="var(--color-blade-mid)" />
          <stop offset="50%" stopColor="var(--color-blade-spec)" />
          <stop offset="74%" stopColor="var(--color-blade-mid)" />
          <stop offset="100%" stopColor="var(--color-blade-shadow)" />
        </linearGradient>
        {/* Heavier metal for the spine so it reads as the thick top. */}
        <linearGradient id="re-blade-spine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-blade-spec)" />
          <stop offset="60%" stopColor="var(--color-blade-mid)" />
          <stop offset="100%" stopColor="var(--color-blade-shadow)" />
        </linearGradient>
        {/* The lit honed edge — transparent up top, flaring to amber at the
            very cutting line along the bottom. */}
        <linearGradient id="re-blade-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-edge-glow)" stopOpacity="0" />
          <stop offset="80%" stopColor="var(--color-edge-glow)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--color-edge-glow)" stopOpacity="1" />
        </linearGradient>
        {/* Dark horn scales for the handle. */}
        <linearGradient id="re-scale" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.36 0.02 60)" />
          <stop offset="48%" stopColor="oklch(0.2 0.018 58)" />
          <stop offset="100%" stopColor="oklch(0.13 0.012 56)" />
        </linearGradient>
        <linearGradient id="re-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brass-strong)" />
          <stop offset="100%" stopColor="var(--color-brass-muted)" />
        </linearGradient>
      </defs>

      {/* ── HANDLE / SCALES — drop away from the pivot at an OPEN ANGLE ──
          The whole handle group is rotated ~32° down from the pivot so the
          blade (above) and handle (below) form the open "V" of a cut-throat
          razor. The pivot is at (150,70). */}
      <g transform="rotate(32 150 70)">
        {/* Lower scale leaf. */}
        <path
          d="M150 80 L30 84 C20 84 14 80 14 75 C14 70 20 66 30 66 L150 64 Z"
          fill="url(#re-scale)"
          stroke="var(--color-blade-shadow)"
          strokeWidth="1"
        />
        {/* Upper scale leaf — slightly inset so the pair reads as folded. */}
        <path
          d="M150 70 L42 72 C33 72 28 69 28 65 C28 61 33 58 42 58 L150 58 Z"
          fill="url(#re-scale)"
          stroke="var(--color-blade-shadow)"
          strokeWidth="1"
          opacity="0.9"
        />
        {/* Brass wedge pin at the very tail. */}
        <circle cx="26" cy="71" r="4.5" fill="url(#re-brass)" />
        {/* Brushed highlight down the scale. */}
        <path
          d="M44 70 L140 67"
          stroke="var(--color-blade-spec)"
          strokeWidth="0.8"
          opacity="0.25"
        />
      </g>

      {/* ── PIVOT PIN / COLLAR (the hinge where blade meets handle) ─────── */}
      <circle
        cx="150"
        cy="70"
        r="9"
        fill="url(#re-brass)"
        stroke="var(--color-blade-shadow)"
        strokeWidth="1"
      />
      <circle cx="150" cy="70" r="2.6" fill="var(--color-blade-shadow)" />

      {/* ── TANG + THUMB NOTCH (between pivot and blade) ───────────────── */}
      <path
        d="M158 60 L186 58 L186 82 L166 82 C160 82 158 79 158 74 Z"
        fill="url(#re-blade-spine)"
        stroke="var(--color-blade-shadow)"
        strokeWidth="0.75"
      />
      {/* Crescent thumb-notch carved into the underside of the tang. */}
      <path
        d="M166 82 C170 73 180 73 184 82 Z"
        fill="var(--hero-field-top, #111)"
      />

      {/* ── BLADE — runs out level from the tang to a rounded point ─────── */}
      <path
        d="M184 52
           L452 46
           C466 46 472 49 472 54
           C472 60 466 64 452 66
           L208 80
           C192 81 184 75 184 68
           Z"
        fill="url(#re-blade-face)"
        stroke="var(--color-blade-shadow)"
        strokeWidth="0.75"
      />
      {/* The SPINE — a thicker, brighter band hugging the top of the blade so
          the "thick top / sharp bottom" of a real razor reads clearly. */}
      <path
        d="M186 52 L452 46.5 C462 46.5 468 49 468 52.5 L190 58 C187 58 185 56 185 54 Z"
        fill="url(#re-blade-spine)"
        opacity="0.95"
      />
      {/* Specular glint travelling the blade face. */}
      <path
        d="M206 58 L440 52"
        stroke="var(--color-blade-spec)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* The honed CUTTING EDGE — a thin lit line along the bottom of the
          blade where the amber glow concentrates; this is the line that does
          the incision through the wordmark. */}
      <path
        d="M208 79 C300 74 400 66 452 64"
        stroke="url(#re-blade-edge)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* A brighter amber kiss right at the leading point. */}
      <circle cx="458" cy="58" r="3.5" fill="var(--color-edge-glow)" opacity="0.85" />
    </svg>
  );
}
