import { ArrowDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { DIRECTORY_SECTION_ID } from '@/lib/site-nav';

/**
 * The quiet scroll affordance under the wordmark (Task 3.2). A small, calm cue —
 * a label and a gently bobbing arrow — that invites the descent without shouting.
 *
 * It is a real, focusable `<a>` that jumps to the directory (the no-cinema floor)
 * so a keyboard user who does not want to scroll the cinema can still reach every
 * project immediately. The bob is a CSS-only decorative animation on the
 * `aria-hidden` arrow, disabled under the reduced-motion floor — it is NOT
 * scroll-driven (GSAP owns scroll, ADR-002).
 *
 * SERVER component.
 */
export function ScrollCue(): ReactNode {
  return (
    <a
      href={`#${DIRECTORY_SECTION_ID}`}
      className="text-fg-subtle hover:text-fg group inline-flex flex-col items-center gap-2 rounded-md text-xs tracking-[0.18em] uppercase transition-colors"
    >
      <span>Descend</span>
      <span
        aria-hidden
        className="border-border-strong group-hover:border-light/60 atrium-cue-bob flex size-8 items-center justify-center rounded-full border transition-colors"
      >
        <ArrowDown className="size-4" />
      </span>
    </a>
  );
}
