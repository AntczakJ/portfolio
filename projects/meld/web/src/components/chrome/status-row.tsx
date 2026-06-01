import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Bottom subtle status row.
 *
 * Deliberately NOT a heavy status bar (tape's status bar carries API
 * latency, WS connection state, tick counters — appropriate for a
 * trader terminal, wrong for a creative tool). Meld's bottom row is
 * a single-line muted helpline that hints at the wow moment ("the
 * thing that makes it real") plus a small attribution.
 *
 * Three viewport regimes:
 *  - >= 768 px (tablet + desktop): both cells render, two columns.
 *  - 640–767 px: helpline collapses to a single line, both still
 *    render.
 *  - < 640 px (mobile): the entire row hides — the screen is too
 *    narrow for the hint and the New board CTA in the top bar is
 *    the only affordance worth keeping above the fold.
 *
 * Below the canvas-edit threshold (< 768 px) the wow moment cannot
 * happen on this device anyway (meld degrades to view-only per
 * PLAN.md success criteria — Phase 2.6 enforces it), so hiding the
 * "open in two tabs" hint at < 640 px is not a loss of information,
 * it is the right truth-in-advertising.
 */
export function StatusRow(): ReactNode {
  return (
    <footer
      role="contentinfo"
      className="hidden shrink-0 items-center justify-between gap-3 border-t border-(--color-border) bg-(--color-bg) px-4 py-3 text-xs text-(--color-fg-muted) sm:flex sm:px-6"
    >
      <p className="flex items-center gap-2 font-mono">
        <Sparkles
          className="size-3.5 text-(--color-accent)"
          aria-hidden="true"
        />
        <span>
          Open this board in two tabs to see live presence in action.
        </span>
      </p>
      <p className="font-mono text-(--color-fg-subtle)">Meld</p>
    </footer>
  );
}
