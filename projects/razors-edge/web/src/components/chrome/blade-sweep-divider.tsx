'use client';

import { useRef, type ReactNode } from 'react';

import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';
import { cn } from '@/lib/cn';

interface BladeSweepDividerProps {
  /** Extra classes on the wrapper (e.g. vertical rhythm). */
  className?: string;
  /**
   * Visual weight. `hairline` is the default recurring edge between
   * sections; `bold` is a slightly heavier statement divider.
   */
  weight?: 'hairline' | 'bold';
  /** Accessible label is suppressed — this is a decorative separator. */
  'aria-hidden'?: boolean;
}

/**
 * Blade-sweep divider (Task 3.1) — the recurring "lit edge" motif that
 * connects sections, echoing the hero's honed-blade highlight.
 *
 * A thin amber edge line (the `--color-edge-glow` brass) that, on scroll
 * into view, sweeps open from the centre to full width with a soft glow
 * tracking its leading points — the same blade-cut language as the hero,
 * reused as connective tissue (PLAN.md: "section dividers are
 * blade-sweeps").
 *
 * Motion is GSAP per ADR-002 (scroll = GSAP), authored inside `useGSAP`
 * with a `gsap.matchMedia` reduced-motion branch: under reduced motion the
 * line is simply present at full width (no sweep), so the divider always
 * reads. Transform/opacity only (`scaleX`), `will-change` added transiently
 * by GSAP. Decorative: `role="separator"` + `aria-hidden`.
 */
export function BladeSweepDivider({
  className,
  weight = 'hairline',
}: BladeSweepDividerProps): ReactNode {
  const scope = useRef<HTMLDivElement>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          animate: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const line = scope.current?.querySelector<HTMLElement>(
            '[data-blade-line]',
          );
          const glow = scope.current?.querySelector<HTMLElement>(
            '[data-blade-glow]',
          );
          if (!line) return;

          const reduced = ctx.conditions?.reduced ?? false;
          if (reduced) {
            gsap.set([line, glow].filter(Boolean), { scaleX: 1, opacity: 1 });
            return;
          }

          gsap.set(line, { scaleX: 0, transformOrigin: 'center center' });
          if (glow) gsap.set(glow, { opacity: 0 });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: scope.current,
              start: 'top 88%',
              end: 'top 55%',
              scrub: 0.6,
            },
          });
          tl.to(line, { scaleX: 1, ease: 'power2.out' }).to(
            glow ?? {},
            { opacity: 1, ease: 'power1.out' },
            '<0.1',
          );

          return () => {
            tl.scrollTrigger?.kill();
            tl.kill();
          };
        },
      );

      // Coordinated global refresh is requested by `useGsapEffect`; no isolated
      // refresh here (it would race the idle-deferred hero pin).
    },
    [weight],
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
      {/* The lit edge line — brass gradient, fading at both ends. */}
      <div
        data-blade-line
        className={cn(
          'w-full bg-gradient-to-r from-transparent via-[var(--color-edge-glow)] to-transparent',
          weight === 'hairline' ? 'h-px' : 'h-0.5',
        )}
      />
      {/* Soft glow bloom centred on the edge. */}
      <div
        data-blade-glow
        className="pointer-events-none absolute inset-x-0 mx-auto h-px w-2/3"
        style={{
          background:
            'radial-gradient(ellipse 60% 100% at 50% 50%, var(--color-edge-glow), transparent 70%)',
          filter: 'blur(var(--edge-glow-blur))',
        }}
      />
    </div>
  );
}
