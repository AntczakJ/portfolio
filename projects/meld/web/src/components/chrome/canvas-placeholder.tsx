import type { ReactNode } from 'react';

import { NewBoardButton } from '@/components/chrome/new-board-button';

/**
 * Placeholder for the future board canvas.
 *
 * Centered card inviting the viewer to open a board. Phase 2.5
 * replaces this entire component with the live board route
 * (`/board/[boardId]`) and the Canvas2D drawing surface; the chrome
 * around it (top bar, status row) stays exactly as-is.
 *
 * The placeholder reuses the same `NewBoardButton` the top bar uses
 * so the two affordances always behave identically — Phase 2.5's
 * wiring lands once, in `new-board-button.tsx`, not twice.
 *
 * Server Component — no interactivity beyond the button island.
 */
export function CanvasPlaceholder(): ReactNode {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6"
    >
      <section className="flex max-w-md flex-col items-center gap-6 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) px-8 py-12 text-center">
        <p
          aria-hidden="true"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-(--color-fg-subtle)"
        >
          board canvas — Phase 2.5
        </p>
        <h1 className="text-2xl font-medium tracking-tight text-(--color-fg) sm:text-3xl">
          Open a board to start drawing.
        </h1>
        <p className="text-sm leading-relaxed text-(--color-fg-muted)">
          A board is a shared URL. Open it in another tab to see live
          cursors. No sign-up.
        </p>
        <NewBoardButton variant="full" errorMode="inline" />
      </section>
    </main>
  );
}
