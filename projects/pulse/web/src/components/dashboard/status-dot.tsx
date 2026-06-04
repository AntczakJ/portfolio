import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { statusToken, type DisplayStatus } from '@/lib/status/status-tokens';

interface StatusDotProps {
  status: DisplayStatus;
  className?: string;
  /** Render the text label beside the dot (the a11y-default presentation). */
  withLabel?: boolean;
}

/**
 * StatusDot — the atomic status presentation, shared by the board cards,
 * the incident rows, and the public status page.
 *
 * ACCESSIBILITY (AGENT_NOTES gate): status is NEVER color-alone. The dot
 * always carries an accessible name (`role="img"` + `aria-label`), and
 * `withLabel` renders the visible text label too. The visible label uses
 * the AA-legible `-text` token; the dot uses the 3:1 graphical token.
 *
 * The "live pulse" ring on a fresh result / status change is a Phase 3.3
 * Motion micro-interaction layered on top of this primitive — the dot
 * itself stays a pure, render-cheap presentational atom.
 */
export function StatusDot({
  status,
  className,
  withLabel = false,
}: StatusDotProps): ReactNode {
  const token = statusToken(status);

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        role="img"
        aria-label={token.label}
        className={cn(
          'inline-block size-2.5 shrink-0 rounded-full',
          token.dot,
        )}
      />
      {withLabel ? (
        <span className={cn('text-sm font-medium', token.text)}>
          {token.label}
        </span>
      ) : null}
    </span>
  );
}
