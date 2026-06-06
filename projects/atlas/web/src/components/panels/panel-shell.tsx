import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface PanelShellProps {
  title: string;
  /** Optional eyebrow / count rendered at the right of the header. */
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * PanelShell — the shared control-room side-panel chrome (Task 2.1).
 *
 * A backlit-glass panel: token surface, a header with a title + optional meta,
 * the amber sweep divider, and a scrollable body. The fleet panel, the detail
 * panel, and the events feed all sit in this shell so the three side surfaces
 * read as one console. Phase 5 fills the bodies with live content.
 */
export function PanelShell({
  title,
  meta,
  className,
  children,
}: PanelShellProps): ReactNode {
  return (
    <section
      className={cn(
        'border-border bg-surface flex min-h-0 flex-col rounded-lg border',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5">
        <h2 className="text-foreground text-xs font-semibold tracking-wider uppercase">
          {title}
        </h2>
        {meta ? (
          <span className="text-fg-subtle font-mono text-2xs tracking-wide">
            {meta}
          </span>
        ) : null}
      </header>
      <div className="sweep-line opacity-60" aria-hidden="true" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {children}
      </div>
    </section>
  );
}
