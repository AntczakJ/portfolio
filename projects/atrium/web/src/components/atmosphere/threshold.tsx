import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The reusable "threshold / shaft-of-light" transition (Task 3.1).
 *
 * This is the connective tissue of the whole scroll spine (ADR-003): the hero
 * descent hands off through a threshold into the first bay, and every bay-to-bay
 * transition reads as moving from one lit bay of the atrium to the next through a
 * lit doorway. Phase 4 reuses this exact component between the six bays — so it is
 * built here, in Phase 3, against the hero hand-off, with a stable API the bays
 * can drop in.
 *
 * It is a SERVER component, pure CSS/SVG (no WebGL, no JS) — a horizontal seam of
 * warm light with a soft falloff above and below, like the lit lintel of a
 * doorway between two rooms. A signature `accentToken` may be threaded through so
 * the threshold INTO a bay carries a hint of that bay's hue (the "tour of
 * differently-lit rooms" reading) while still resolving to atrium's neutral warm
 * light at the seam itself; without one it is the neutral atrium threshold (the
 * hero hand-off and the directory approach).
 *
 * Degradation: it is a static composition (no animation of its own). Under
 * reduced-motion and no-JS it simply renders as the calm lit seam it always is —
 * nothing to neutralise, nothing to freeze. The GSAP bay choreography (Phase 4)
 * only PARALLAXES it; the resting frame is this static seam.
 */

export interface ThresholdProps {
  /**
   * Optional bay signature-hue token (e.g. `'--bay-tape'`). When present, a faint
   * wash of that hue tints the threshold so the seam INTO a bay foreshadows its
   * room. Omit for the neutral atrium threshold (hero hand-off / directory).
   */
  accentToken?: string;
  /**
   * Vertical weight of the seam. `'major'` (default) is the hero→gallery and
   * gallery→directory hand-offs; `'minor'` is the quieter bay-to-bay seam.
   */
  weight?: 'major' | 'minor';
  className?: string;
}

export function Threshold({
  accentToken,
  weight = 'major',
  className,
}: ThresholdProps): ReactNode {
  const isMajor = weight === 'major';

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none relative w-full overflow-hidden',
        isMajor ? 'h-[34vh] min-h-48' : 'h-[22vh] min-h-32',
        className,
      )}
      data-threshold={weight}
    >
      {/* The lit lintel: a horizontal warm seam, brightest at its centre line,
          falling off symmetrically into the field above and below. */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,transparent,var(--shaft-core)_45%,var(--shaft-core)_55%,transparent)]" />
      <div
        className={cn(
          'absolute inset-x-0 top-1/2 -translate-y-1/2',
          isMajor ? 'h-40' : 'h-28',
          'bg-[radial-gradient(60%_100%_at_50%_50%,var(--shaft-mid),transparent_72%)]',
        )}
      />

      {/* D-08 — the major seam (the hero→gallery hand-off) carries an ATRIUM ECHO:
          a faint colonnade-floor glow rising from the bottom so the threshold
          reads as the lit hall CONTINUING into the bay, not a bare divider. This
          is the visible doorway the descent's hand-off bloom rises THROUGH, so the
          bays sit INSIDE the atrium. */}
      {isMajor ? (
        <div className="absolute inset-x-0 bottom-0 h-24 bg-[radial-gradient(80%_120%_at_50%_140%,var(--floor-pool),transparent_70%)] opacity-70" />
      ) : null}

      {/* Bay-hue wash — the lit doorway INTO the room carries the room's colour so
          the threshold foreshadows the differently-lit bay ahead (D-04). Stronger
          than before (it was opacity-25 and barely registered), but still resolves
          to the neutral warm seam at the bright centre line above it. Dynamic
          token => inline style. */}
      {accentToken ? (
        <div
          className={cn(
            'absolute inset-x-0 top-1/2 -translate-y-1/2 opacity-55',
            isMajor ? 'h-44' : 'h-36',
          )}
          style={{
            background: `radial-gradient(60% 100% at 50% 50%, color-mix(in oklab, var(${accentToken}) 60%, transparent), transparent 72%)`,
          }}
        />
      ) : null}
    </div>
  );
}
