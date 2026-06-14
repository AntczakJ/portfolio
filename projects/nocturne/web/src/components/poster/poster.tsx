import type { ReactNode } from 'react';

import { DEFAULT_PRESET_ID } from '@/data/presets';
import { posterBackground } from '@/lib/poster/poster-gradient';

/**
 * The DESIGNED poster still (ADR-004 §3) — the LCP element and the no-JS / Tier-4
 * surface. A software-GL headless capture cannot yield a true-GPU frame, so this
 * is an authored luminous-field gradient evoking the default preset (the same
 * palette the live field ramps through, via {@link posterBackground}), finished
 * with a fine SVG grain so it reads as a film still, not a flat CSS gradient.
 *
 * Server-renderable (no hooks) so it is in the SSR HTML at first paint — the
 * reserved-box LCP that the live canvas cross-fades in over once ready. The
 * stage stays dark in both chrome themes (theme-invariant `--stage-*` tokens via
 * the floor + the preset palette glows).
 */

export interface PosterProps {
  presetId?: string;
  /** Whether to show the NOCTURNE wordmark over the still (the hero/no-JS view). */
  withWordmark?: boolean;
  className?: string;
}

export function Poster({
  presetId = DEFAULT_PRESET_ID,
  withWordmark = false,
  className,
}: PosterProps): ReactNode {
  return (
    <div
      className={`relative h-full w-full overflow-hidden ${className ?? ''}`}
      aria-hidden={!withWordmark}
    >
      {/* the layered luminous-field glow (the preset's palette energy) */}
      <div
        className="absolute inset-0"
        style={{ background: posterBackground(presetId) }}
      />
      {/* a soft vignette so the field reads cinematic, framed */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 120% at 50% 42%, transparent 48%, rgba(2,3,8,0.72) 100%)',
        }}
      />
      {/* fine film grain — the "designed still" finish, not a flat gradient */}
      <PosterGrain />
      {withWordmark ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span
            className="font-[family-name:var(--font-display)] font-semibold"
            style={{
              color: 'var(--hud-ink)',
              fontSize: 'var(--text-6xl)',
              lineHeight: 'var(--leading-tight)',
              letterSpacing: 'var(--tracking-wider)',
              textShadow: '0 2px 40px rgba(0,0,0,0.55)',
            }}
          >
            NOCTURNE
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A fine, low-opacity fractal-noise grain via an inline SVG data URI (no fetch,
 * CSP-clean under `img-src 'self' data:`). Gives the gradient a tactile film
 * texture so the poster reads as intentional.
 */
function PosterGrain(): ReactNode {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`;
  return (
    <div
      className="absolute inset-0 opacity-[0.05] mix-blend-screen"
      style={{
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        backgroundSize: '160px 160px',
      }}
    />
  );
}
