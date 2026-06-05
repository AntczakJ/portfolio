import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface WordmarkProps {
  className?: string;
  /**
   * `lockup` adds the voltaic accent tracking-dot before the type — the header
   * lockup. `plain` is just the type (used inside the hero where the big
   * display wordmark already carries the brand weight).
   */
  variant?: 'lockup' | 'plain';
}

/**
 * The APEX wordmark — Space Grotesk display cut as a Klim-grade specimen lockup
 * (D-13). The mark is the brand's signature, so it earns deliberate detail:
 *
 *   - The type is set tight (a confident, engineered spacing, not a generic
 *     wide-tracked SaaS logo) with a hairline gap CONTROLLED per letter via the
 *     `tracking` token, and the trailing letter loses its trailing space so the
 *     accent mark sits flush against the type.
 *   - A short voltaic "track" mark — a 2px accent bar, the brand's track-line
 *     motif distilled into the mark itself — precedes the type in the `lockup`
 *     variant. It reads as a charge/track indicator and threads the wordmark
 *     into the recurring track-line motif. The accent is the vivid fill as a
 *     SOLID surface, never accent-text-on-light (AGENT_NOTES Task 2.1 contract).
 */
export function Wordmark({
  className,
  variant = 'lockup',
}: WordmarkProps): ReactNode {
  return (
    <span
      className={cn(
        'font-display text-foreground inline-flex items-center gap-2.5 leading-none font-bold tracking-[0.08em] uppercase',
        className,
      )}
    >
      {variant === 'lockup' ? (
        <span
          aria-hidden="true"
          className="bg-accent inline-block h-[0.7em] w-[3px] rounded-[1px]"
        />
      ) : null}
      <span className="-mr-[0.08em]">APEX</span>
    </span>
  );
}
