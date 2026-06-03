'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useScrollReveal } from '@/lib/gsap/use-scroll-reveal';

interface RevealGroupProps {
  children: ReactNode;
  className?: string;
  /** Stagger between successive `[data-reveal]` children (s). */
  stagger?: number;
  /** Initial downward offset (px). */
  y?: number;
  /** ScrollTrigger start. */
  start?: string;
}

/**
 * A thin client wrapper that provides a GSAP scroll-reveal scope around
 * otherwise server-rendered children (Phase 4).
 *
 * Lets the section bodies stay Server Components (real DOM for SEO / SR /
 * the no-JS floor) while the kinetic reveal is a small client leaf — the
 * lowest possible `'use client'` boundary (docs/conventions.md § 3). Mark
 * the children to reveal with `data-reveal`; the reveal degrades to the
 * resting state under reduced motion (the hook handles it).
 */
export function RevealGroup({
  children,
  className,
  stagger,
  y,
  start,
}: RevealGroupProps): ReactNode {
  const scope = useScrollReveal<HTMLDivElement>({
    ...(stagger !== undefined ? { stagger } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(start !== undefined ? { start } : {}),
  });
  return (
    <div ref={scope} className={cn(className)}>
      {children}
    </div>
  );
}
