'use client';

import {
  createElement,
  useRef,
  type ElementType,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Render element (default `div`). */
  as?: ElementType;
  /**
   * Stagger child reveal across direct elements matching `[data-reveal-item]`.
   * When false (default) the whole block reveals as one.
   */
  stagger?: boolean;
  /** Initial upward travel distance in px (transform-only). */
  y?: number;
}

/**
 * Reveal-on-scroll (Phase 5) — apex's masked/lifted entrance for editorial
 * content (the fleet list, the value section, the locations + testimonials).
 *
 * Motion is GSAP (ADR-002: scroll = GSAP), authored inside `useGsapEffect` with
 * a `gsap.matchMedia` reduced-motion branch. The content is REAL server-rendered
 * DOM at full opacity in the markup (the no-JS / SEO / a11y floor) — GSAP only
 * sets the hidden initial state once it runs and animates it in on scroll. So a
 * no-JS or reduced-motion user always sees the complete, legible content (under
 * reduced motion the items resolve to their final static state, no travel).
 *
 * Transform/opacity only; `will-change` is added transiently then cleared.
 * `idle: false` so an item already in the viewport on load does not flash hidden
 * during a long idle gap.
 */
export function Reveal({
  children,
  className,
  as,
  stagger = false,
  y = 28,
}: RevealProps): ReactNode {
  const scope = useRef<HTMLDivElement>(null);
  const tag: ElementType = as ?? 'div';

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      if (!root) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          animate: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (ctx) => {
          const targets = stagger
            ? root.querySelectorAll<HTMLElement>('[data-reveal-item]')
            : [root];
          if (targets.length === 0) return;

          // Reduced motion: nothing to do — the markup already shows the final
          // state (full opacity, no transform). Do NOT hide-then-skip.
          if (ctx.conditions?.reduced) return;

          gsap.set(targets, {
            opacity: 0,
            y,
            willChange: 'transform, opacity',
          });

          const tween = gsap.to(targets, {
            opacity: 1,
            y: 0,
            duration: 0.7,
            ease: 'power3.out',
            stagger: stagger ? 0.08 : 0,
            scrollTrigger: {
              trigger: root,
              start: 'top 85%',
              once: true,
            },
          });

          return () => {
            tween.scrollTrigger?.kill();
            tween.kill();
            gsap.set(targets, { clearProps: 'willChange' });
          };
        },
      );
    },
    [stagger, y],
  );

  // `createElement` keeps the dynamic-tag ref/className well-typed (a JSX
  // `<Tag>` over a generic ElementType narrows props to `never`).
  return createElement(
    tag,
    { ref: scope, className: cn(className) },
    children,
  );
}
