import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The volumetric-warm-light background layer + anti-banding grain (Task 3.1).
 *
 * This is atrium's signature surface — "the atrium is a space made of light"
 * (ADR-001). It is built ENTIRELY from CSS/SVG (no WebGL — ADR-001/002, and the
 * Lighthouse budget on the most-judged page forbids the GPU-3D cost): a layered
 * field gradient (the unlit shell), a soft vignette that frames the content, and
 * a very subtle SVG-noise grain that prevents banding on the large dark
 * gradients. All of it reads the `--field-*` / `--grain-opacity` surface hooks
 * authored in Phase 2.1, so it re-tunes for the intentional light "architectural
 * daylight" theme automatically.
 *
 * It is a SERVER component (no interactivity), `aria-hidden`, `pointer-events-
 * none`, and `fixed` so it underlays the whole scroll without re-painting per
 * section. The hero's own warm SHAFT of light is a separate, hero-local layer
 * (the hero owns the descent-coupled shaft); this is the ambient field behind
 * everything.
 *
 * Grain technique: an inline SVG `feTurbulence` data-URI as a CSS `background-
 * image`, scaled small and tiled, at `--grain-opacity` (≈ 0.03–0.045). It is
 * static (no animation — determinism + no compositor cost) and invisible except
 * as a texture that kills 8-bit gradient banding. `mix-blend-overlay` lets it sit
 * on both themes without inverting.
 */

/** A tiny fractal-noise tile, inlined as a data-URI (no network, CSP-clean). */
const GRAIN_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function LightField(): ReactNode {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* The atrium field: a vertical shell gradient from the deep top to a
          faintly-warmer floor — the architecture the light falls into. In light
          theme these stops are a daylit-top → limestone-floor wash (D-03), so the
          field is never a flat document. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--field-top)_0%,var(--field-bottom)_100%)]" />

      {/* DIRECTIONAL clerestory skylight — a soft volumetric WEDGE raking down
          from the top, with a visible falloff (the daylight-not-flat fix, D-03).
          A conic-ish wedge built from a tall narrow radial offset toward the top,
          token-driven so it re-keys to architectural daylight in light theme. */}
      <div className="absolute inset-x-0 top-0 h-[88vh] bg-[radial-gradient(58%_92%_at_50%_-22%,var(--shaft-core),var(--shaft-mid)_30%,transparent_66%)] opacity-80" />

      {/* A broad, soft overhead warm bloom widening the skylight into the hall. */}
      <div className="absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(130%_70%_at_50%_-18%,var(--shaft-mid),transparent_72%)] opacity-60" />

      {/* A warm floor wash — light pooling on the ground of the atrium so the
          space has a lit floor, not just a lit ceiling (anchors the daylight). */}
      <div className="absolute inset-x-0 bottom-0 h-[40vh] bg-[radial-gradient(90%_120%_at_50%_125%,var(--floor-pool),transparent_72%)] opacity-50" />

      {/* Framing vignette — pulls focus to the centre column and deepens the
          edges so content never floats on a flat field. */}
      <div className="absolute inset-0 bg-[radial-gradient(125%_125%_at_50%_36%,transparent_52%,var(--field-vignette)_100%)]" />

      {/* Anti-banding grain — static SVG noise, tiled, blended. */}
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{
          backgroundImage: GRAIN_DATA_URI,
          backgroundRepeat: 'repeat',
          backgroundSize: '140px 140px',
          opacity: 'var(--grain-opacity)',
        }}
      />
    </div>
  );
}

/**
 * A localised warm shaft of light — the directed beam that lights a wordmark or a
 * bay title. Reusable beyond the hero (the bays reuse the threshold motif and may
 * want a directed light too), so it is factored out here. Pure CSS conic/radial
 * gradients reading the `--shaft-*` hooks; `aria-hidden`, no interactivity.
 *
 * `intensity` scales the core opacity for foreground (hero) vs background (a bay
 * accent) use. The shaft is anchored from the top centre and fans downward, like
 * light through a high clerestory window.
 */
export function LightShaft({
  className,
  intensity = 'full',
}: {
  className?: string;
  intensity?: 'full' | 'soft';
}): ReactNode {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
    >
      {/* The beam body: a tall, narrow radial fanning from the top centre. */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-full',
          'bg-[radial-gradient(45%_95%_at_50%_-8%,var(--shaft-core),var(--shaft-mid)_28%,var(--shaft-edge)_62%)]',
          intensity === 'soft' && 'opacity-60',
        )}
      />
      {/* A second, wider, fainter pass softens the beam edges into the field so
          there is no hard cone outline (banding-free falloff). */}
      <div className="absolute inset-x-0 top-0 h-full bg-[radial-gradient(70%_80%_at_50%_-20%,var(--shaft-mid),transparent_60%)] opacity-50" />
    </div>
  );
}
