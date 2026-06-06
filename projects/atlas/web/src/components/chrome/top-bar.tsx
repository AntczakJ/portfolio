import { Radar } from 'lucide-react';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/chrome/theme-toggle';
import { ConnectionPill } from '@/components/chrome/connection-pill';
import { DEMO_CITY_NAME } from '@/lib/fleet/demo-city';

/**
 * Control-room top bar (Task 2.1) — the persistent header of the operations
 * console. A Server Component: it renders static chrome and mounts the two
 * client islands it needs (the theme toggle + the connection pill).
 *
 * Layout: wordmark + city context on the left, the live-connection pill in the
 * centre-right, the theme toggle on the right. The thin amber sweep-line under
 * the bar is the "radar sweep" brand motif (globals.css `.sweep-line`).
 */
export function TopBar(): ReactNode {
  return (
    <header className="border-border bg-surface/80 relative z-20 backdrop-blur-md">
      <div className="flex h-[var(--topbar-height)] items-center gap-4 px-[var(--space-gutter)]">
        <div className="flex items-center gap-2.5">
          <span
            className="bg-accent-soft text-accent-ink flex size-7 items-center justify-center rounded-md"
            aria-hidden="true"
          >
            <Radar className="size-4" />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-foreground text-md font-semibold tracking-tight">
              Atlas
            </span>
            <span className="text-fg-subtle hidden text-xs tracking-wider uppercase sm:inline">
              Fleet Operations
            </span>
          </div>
        </div>

        <div className="text-fg-subtle hidden items-center gap-1.5 text-xs md:flex">
          <span className="bg-border-strong h-3 w-px" aria-hidden="true" />
          <span className="font-mono tracking-wide">{DEMO_CITY_NAME}</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <ConnectionPill />
          <ThemeToggle />
        </div>
      </div>
      <div className="sweep-line" aria-hidden="true" />
    </header>
  );
}
