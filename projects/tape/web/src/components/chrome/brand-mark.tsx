import type { ReactNode } from 'react';

/**
 * Text-only brand mark. Per PLAN.md: monospaced, slightly larger than
 * body text, no logo asset in v1. Server Component.
 */
export function BrandMark(): ReactNode {
  return (
    <span className="font-mono text-base font-medium tracking-tight text-(--color-fg)">
      Tape
    </span>
  );
}
