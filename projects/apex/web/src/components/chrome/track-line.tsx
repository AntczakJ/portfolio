'use client';

import { useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';

interface TrackLineProps {
  className?: string;
  /**
   * `hairline` is the default recurring section edge; `bold` is a heavier
   * statement divider for major section breaks.
   */
  weight?: 'hairline' | 'bold';
  /**
   * `static` skips the GSAP scroll-reveal entirely (renders the line at rest) —
   * for places where the divider is decoration that should not animate (e.g.
   * inside the footer). Default `reveal` sweeps open from centre on scroll.
   */
  behavior?: 'reveal' | 'static';
}

/**
 * Track-line (Task 4.1) — apex's signature recurring motif.
 *
 * The thin voltaic accent "track" line (the brand's spine — globals.css
 * `--gradient-track`, `--color-track-glow`) that recurs across the hero,
 * dividers, the configurator studio floor, and the fleet/gallery reveals. On
 * scroll into view it sweeps OPEN from the centre to full width with a soft
 * accent glow — the same lit-edge language reused as connective tissue.
 *
 * Motion is GSAP (ADR-002: scroll = GSAP), authored inside `useGsapEffect`
 * with a `gsap.matchMedia` reduced-motion branch — under reduced motion the
 * line is simply present at full width (no sweep), so the divider ALWAYS reads.
 * Transform/opacity only (`scaleX`); `will-change` added transiently then
 * cleared. Decorative: `role="separator"` + `aria-hidden`. The static markup is
 * the floor — the gradient line is real DOM/CSS, so a no-JS user still sees a
 * complete divider; GSAP only animates the entrance.
 */
export function TrackLine({
  className,
  weight = 'hairline',
  behavior = 'reveal',
}: TrackLineProps): ReactNode {
  const scope = useRef<HTMLDivElement>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      if (behavior === 'static') return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          animate: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const line = scope.current?.querySelector<HTMLElement>(
            '[data-track-line]',
          );
          const glow = scope.current?.querySelector<HTMLElement>(
            '[data-track-glow]',
          );
          if (!line) return;

          if (ctx.conditions?.reduced) {
            gsap.set(line, { scaleX: 1, opacity: 1 });
            if (glow) gsap.set(glow, { scaleX: 1, opacity: 1 });
            return;
          }

          // The hairline is ALWAYS present (legible at rest, D-13) — the motif
          // must read even before scroll. Only the lit accent segment animates:
          // it sweeps OPEN from the centre and brightens as the divider enters
          // view, so the brand thread is visible at rest and "lights up" on
          // approach (the Linear-grade lit-edge language).
          gsap.set(line, { scaleX: 1, opacity: 1 });
          if (glow) {
            gsap.set(glow, {
              scaleX: 0,
              opacity: 0,
              transformOrigin: 'center center',
              willChange: 'transform, opacity',
            });
          }

          if (!glow) return;
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: scope.current,
              start: 'top 92%',
              end: 'top 58%',
              scrub: 0.6,
            },
          });
          tl.to(glow, { scaleX: 1, opacity: 1, ease: 'power2.out' });

          return () => {
            tl.scrollTrigger?.kill();
            tl.kill();
            gsap.set(glow, { clearProps: 'willChange' });
          };
        },
      );
    },
    [behavior, weight],
  );

  return (
    <div
      ref={scope}
      role="separator"
      aria-hidden="true"
      className={cn(
        'relative flex w-full items-center justify-center overflow-hidden',
        className,
      )}
    >
      <div
        data-track-line
        className={cn(
          'w-full',
          weight === 'hairline' ? 'h-px' : 'h-0.5',
        )}
        style={{ background: 'var(--gradient-track)' }}
      />
      {/* The lit accent segment that sweeps open on scroll (the "lights up on
          approach" moment). Sits over the always-present hairline. */}
      <div
        data-track-glow
        className="pointer-events-none absolute inset-x-0 mx-auto h-px w-3/5"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--color-track-glow) 50%, transparent)',
          boxShadow: '0 0 8px 1px var(--color-track-glow)',
        }}
      />
    </div>
  );
}
