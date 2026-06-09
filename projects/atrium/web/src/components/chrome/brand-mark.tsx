import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { HERO_SECTION_ID } from '@/lib/site-nav';

/**
 * The compact ATRIUM brand mark — the header (left) and footer use it. It is a
 * scaled-down specimen of the hero wordmark (same display grotesque, same warm
 * light token), set in the structural Bricolage face so it reads as the same
 * identity as the hero, not a separate logo.
 *
 * It is a real anchor back to the top of the page (`#top`), with a discernible
 * accessible name. SERVER component — no interactivity beyond the link.
 */
export function BrandMark({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'lg';
}): ReactNode {
  return (
    <a
      href={`#${HERO_SECTION_ID}`}
      aria-label="Atrium — back to top"
      className={cn(
        'font-display text-fg inline-flex items-center rounded-sm leading-none tracking-tight',
        'transition-colors hover:text-light-strong',
        size === 'sm' ? 'text-lg' : 'text-2xl',
        className,
      )}
    >
      <span
        className="font-semibold"
        // The wordmark wants the display face's confident weight; the base layer
        // binds the axes, this nudges weight up for the mark specifically.
        style={{ fontVariationSettings: "'wght' var(--display-wght-bold)" }}
      >
        ATRIUM
      </span>
    </a>
  );
}
