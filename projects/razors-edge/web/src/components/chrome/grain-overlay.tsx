import type { ReactNode } from 'react';

/**
 * Film-grain / noise overlay (ADR-004 layer 6; PLAN.md "Texture").
 *
 * A single fixed, full-viewport tiled SVG noise layer that recurs across
 * the whole site so type-over-photo composites read as one cinematic
 * frame rather than two stacked layers. Pure CSS/SVG (NOT WebGL) so it is
 * invisible to the Lighthouse performance budget (a fractal-noise
 * `feTurbulence` rendered once into a tiny tiled data URI, GPU-cheap).
 *
 * The grain is decorative: `aria-hidden` and `pointer-events-none` so it
 * never traps focus or interaction. Opacity reads the sovereign
 * `--grain-opacity` token (tuned per theme — lower on bright paper). The
 * layer sits `fixed` at a low z-index above the page background but below
 * content, and `mix-blend-mode: overlay` lets it modulate both dark and
 * light grounds without washing them out.
 *
 * Server component — no interactivity. Mounted once in the root layout.
 */
const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function GrainOverlay(): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] mix-blend-overlay"
      style={{
        backgroundImage: NOISE_DATA_URI,
        backgroundRepeat: 'repeat',
        opacity: 'var(--grain-opacity)',
      }}
    />
  );
}
