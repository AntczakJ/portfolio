import type { ReactNode } from 'react';

import { ApiStatusDot } from '@/components/chrome/api-status-dot';
import { BrandMark } from '@/components/chrome/brand-mark';
import { IdentityBadge } from '@/components/chrome/identity-badge';
import { NewBoardButton } from '@/components/chrome/new-board-button';
import { ThemeToggle } from '@/components/chrome/theme-toggle';
import { Separator } from '@/components/ui/separator';
import type { InitialIdentity } from '@/lib/identity/use-identity';

/**
 * Persistent application top bar.
 *
 * Left cluster, left-to-right:
 *  - Brand wordmark "Meld" (server-rendered, non-interactive).
 *  - Vertical separator.
 *  - Identity badge (Task 2.5b — cookie-derived emoji + name,
 *    upgraded with the WS welcome-frame color when Task 2.5a wires
 *    the awareness handler). Client island.
 *  - Vertical separator.
 *  - API health pip — subtle 6 px dot, three states (ok / idle /
 *    error). Client island.
 *
 * Right cluster, left-to-right:
 *  - Primary CTA "New board" + a vertical separator + the theme
 *    toggle. The separator carries the "these two controls belong
 *    together but are different concerns" hint without forcing a
 *    border-treatment that would compete with the bar's own border.
 *
 * Server Component shell — `<TopBar />` is rendered from
 * `app/layout.tsx` which fetches the initial identity on the server
 * and threads it through `initialIdentity` so the badge SSR-renders
 * with the deterministic emoji + name from the cookie. No flash of
 * empty content while the WS welcome arrives.
 *
 * No left rail — meld is a single-board-per-URL experience and a rail
 * would imply a workspace-nav surface the product does not have (see
 * `app/layout.tsx` for the departure comment).
 *
 * Responsive: at < 640 px the CTA collapses to its icon-only
 * compact form so the bar stays single-row at 320 px. The identity
 * badge stays at all widths because the emoji + 1-2 word name fits a
 * 320 px shell without crowding the brand cluster; if it ever feels
 * tight under a designer-critic pass, the name slot collapses first
 * to an emoji-only ring with the tooltip still carrying the name.
 */
export interface TopBarProps {
  initialIdentity: InitialIdentity | null;
}

export function TopBar({ initialIdentity }: TopBarProps): ReactNode {
  return (
    <header
      role="banner"
      className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-(--color-border) bg-(--color-bg) px-4 sm:h-14 sm:px-6"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <BrandMark />
        <Separator
          orientation="vertical"
          className="data-[orientation=vertical]:h-5"
        />
        {/* Task 2.5b — Brand-corner identity badge. Server-fetched
            initial identity from the `meld_session` cookie; client
            island that upgrades the color ring when the WS welcome
            frame arrives (Task 2.5a wires the welcome-store update). */}
        <IdentityBadge initial={initialIdentity} />
        <Separator
          orientation="vertical"
          className="data-[orientation=vertical]:h-5"
        />
        {/* Task 2.2 — API health pip. Subtle 6 px dot sitting just to
            the right of the identity badge. Three states: ok (calm
            green), idle/loading (muted neutral), error
            (--color-error). The wordmark stays the brand anchor; the
            pip disappears under attention when the API is healthy.
            Client island. */}
        <ApiStatusDot />
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Compact variant at 320–639 px; full at 640 px+. We render
            the actual collapse via `hidden`/`sm:flex` rather than a
            JS media-query check to keep the SSR output identical to
            the first paint and avoid a hydration flash. */}
        <span className="hidden sm:inline-flex">
          <NewBoardButton variant="full" />
        </span>
        <span className="inline-flex sm:hidden">
          <NewBoardButton variant="compact" />
        </span>
        <Separator
          orientation="vertical"
          className="data-[orientation=vertical]:h-5"
        />
        <ThemeToggle />
      </div>
    </header>
  );
}
