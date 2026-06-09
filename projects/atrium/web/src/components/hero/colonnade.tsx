import type { CSSProperties, ReactNode } from 'react';

/**
 * The atrium-of-light colonnade (Task 3.2, rebuilt for D-01) — the architectural
 * space the descent "drops into" behind the wordmark.
 *
 * D-01 REBUILD. The previous version set `perspective: 900px` on a wrapper but
 * never transformed any child in Z, so the perspective was inert and the planes
 * read as flat venetian-blind / barcode stripes — no vanishing point, no floor,
 * no column gaps. This version builds a GENUINE CSS-3D atrium (still NO WebGL —
 * CSS/SVG only, ADR-001/002):
 *
 *   - A `transform-style: preserve-3d` stage with `perspective` + a low
 *     `perspective-origin` (the camera sits slightly above the floor, looking
 *     down the hall), so every Z-translated child actually converges to a
 *     vanishing point.
 *   - A FLOOR plane (`rotateX(78deg)`) receding to the horizon — the ground the
 *     columns stand on, lit by a pool of warm light at the far end. This is the
 *     spatial anchor the critique said the eye had nothing to stand on.
 *   - Two rows of COLUMNS (left + right colonnade) standing ON that floor, each
 *     column an individual element pushed back in Z (`translateZ`) by depth rank,
 *     so the near columns are large and the far columns shrink toward the
 *     vanishing point — real convergence, with real inter-column GAPS between
 *     standing columns (architecture, not a striped fill).
 *   - A back wall / clerestory glow at the vanishing point (the light at the end
 *     of the hall the descent falls toward).
 *
 * Each depth rank is tagged `data-colonnade-plane` 1 (near) / 2 (mid) / 3 (far)
 * so the descent GSAP scrub can STAGGER the rows by depth (far leads, near
 * trails — fixes the "all planes arrive together" timing note, section 5) and
 * push the camera forward (`translateZ` on the stage) to read as falling INTO
 * the hall.
 *
 * SERVER component — pure markup/CSS, `aria-hidden`. At the resting frame
 * (scroll = 0, reduced-motion, no-JS) it sits softly behind the wordmark as an
 * implied colonnade (so the hero first-frame is unmistakably an ATRIUM, not a
 * generic shaft — closes the D-14 re-skin caveat); the scrub brings it forward.
 */

/** How many column pairs make up the receding colonnade (each side mirrors). */
const COLUMN_RANKS = 7;
/** Depth spacing between successive columns, in px of CSS-3D Z. */
const Z_STEP = 150;

/** Map a 0-based depth rank to the parallax plane bucket (near/mid/far). */
function planeForRank(rank: number): 1 | 2 | 3 {
  if (rank <= 1) return 1;
  if (rank <= 3) return 2;
  return 3;
}

/** One standing column (a slab of warm light) on one side of the hall. */
function Column({ rank, side }: { rank: number; side: 'left' | 'right' }): ReactNode {
  // Near columns sit wide of centre and large; far columns pull toward the
  // vanishing point and shrink (the perspective transform does the shrinking, we
  // only place + push them in Z). The horizontal offset narrows with depth so the
  // two colonnades converge.
  const z = -rank * Z_STEP;
  // Columns nearer the camera sit further from centre (a wider hall up close).
  const xPercent = 50 - rank * 4.6;
  const sign = side === 'left' ? -1 : 1;

  const style: CSSProperties = {
    transform: `translate3d(-50%, 0, ${String(z)}px) translateX(${String(sign * xPercent)}vw)`,
    // Far columns dim into the haze; near columns are brighter.
    opacity: 0.92 - rank * 0.07,
  };

  return (
    <div
      data-colonnade-plane={planeForRank(rank)}
      className="atrium-column absolute bottom-0 left-1/2 h-[72%] w-[8vw] min-w-[44px] max-w-[120px] origin-bottom"
      style={style}
    >
      {/* The column shaft: a vertical slab of light, brighter on its lit edge
          (toward the central shaft) and falling to shadow on the far edge, so it
          reads as a round-ish standing pillar catching the light, not a flat bar. */}
      <div
        className="h-full w-full"
        style={{
          background:
            side === 'left'
              ? 'linear-gradient(90deg, var(--colonnade-shadow) 0%, var(--colonnade-lit) 78%, var(--colonnade-edge) 100%)'
              : 'linear-gradient(270deg, var(--colonnade-shadow) 0%, var(--colonnade-lit) 78%, var(--colonnade-edge) 100%)',
          maskImage:
            'linear-gradient(180deg, transparent 0%, black 18%, black 88%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(180deg, transparent 0%, black 18%, black 88%, transparent 100%)',
        }}
      />
    </div>
  );
}

export function Colonnade(): ReactNode {
  const ranks = Array.from({ length: COLUMN_RANKS }, (_, i) => i);

  return (
    <div
      aria-hidden
      data-colonnade
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* The 3D stage: perspective + a low perspective-origin so the camera looks
          down the hall toward a vanishing point above the floor. The descent scrub
          pushes this stage forward in Z (`data-colonnade-stage`) to fall in. */}
      <div
        data-colonnade-stage
        className="absolute inset-0"
        style={{
          perspective: '1100px',
          perspectiveOrigin: '50% 38%',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* The FLOOR — a plane laid back from the camera receding to the horizon,
            the ground the columns stand on. Warm light pools at the far end. */}
        <div
          data-colonnade-floor
          className="absolute bottom-0 left-1/2 h-[200vh] w-[260vw] origin-bottom -translate-x-1/2"
          style={{
            transform: 'translateX(-50%) rotateX(80deg)',
            transformOrigin: '50% 100%',
            background:
              'radial-gradient(70% 90% at 50% 8%, var(--floor-pool) 0%, var(--floor-mid) 34%, var(--floor-far) 78%)',
            maskImage:
              'linear-gradient(180deg, transparent 0%, black 26%, black 100%)',
            WebkitMaskImage:
              'linear-gradient(180deg, transparent 0%, black 26%, black 100%)',
          }}
        />

        {/* The back wall / clerestory glow at the vanishing point — the light at
            the end of the hall the descent is falling toward. */}
        <div
          data-colonnade-plane={3}
          className="absolute left-1/2 top-[14%] h-[58%] w-[34vw] max-w-[520px] -translate-x-1/2"
          style={{
            transform: `translate3d(-50%, 0, ${String(-COLUMN_RANKS * Z_STEP)}px)`,
            background:
              'radial-gradient(60% 80% at 50% 30%, var(--shaft-core), var(--shaft-mid) 46%, transparent 78%)',
            opacity: 0.85,
          }}
        />

        {/* The two colonnades — left + right rows of standing columns receding to
            the vanishing point, with real gaps between them. Rendered far → near
            so nearer columns paint over farther ones (correct occlusion). */}
        {ranks
          .slice()
          .reverse()
          .map((rank) => (
            <Column key={`l-${String(rank)}`} rank={rank} side="left" />
          ))}
        {ranks
          .slice()
          .reverse()
          .map((rank) => (
            <Column key={`r-${String(rank)}`} rank={rank} side="right" />
          ))}
      </div>

      {/* A foreground haze that deepens the floor edge so the columns never look
          pasted on a flat field — the atmospheric falloff of a deep hall. */}
      <div className="absolute inset-x-0 bottom-0 h-[30%] bg-[linear-gradient(0deg,var(--field-vignette),transparent)] opacity-80" />
    </div>
  );
}
