'use client';

/**
 * <CellReadoutMirror /> — screen-reader live mirror for the hovered
 * footprint cell (Task 3.5).
 *
 * The visual crosshair + cell tooltip (Phase 3.2) surface bid / ask /
 * delta / imbalance% for sighted users. This component is the
 * non-visual equivalent: a visually-hidden `aria-live="polite"` region
 * that announces the hovered cell's values as a spoken sentence, e.g.
 *
 *   "Price 71,250. Bid 2.1, Ask 3.4, Delta +1.3, Imbalance 62% ask."
 *
 * Throttling contract (the load-bearing part):
 *   - The mirror updates its text ONLY when the hovered CELL changes —
 *     keyed on `${bucketTs}:${priceBucket}` — NOT on every pointer
 *     move. Moving the cursor within the same cell produces a stream of
 *     `setCursor` notifications (the `px` field changes), but the cell
 *     identity is stable, so the live region's text node is left
 *     untouched and the screen reader stays silent. This prevents the
 *     live region from spamming on rapid cursor movement.
 *   - When the cursor leaves the chart (`cursor === null`) the text is
 *     cleared so a stale reading is not re-announced.
 *   - This is separate from the visual tooltip's own re-render cadence
 *     (the tooltip re-renders on px change to reposition; the mirror
 *     does not).
 *
 * Why a dedicated node rather than reusing the tooltip's `aria-live`:
 *   - The tooltip is positioned with `visibility: hidden` when not
 *     hovering, which yo-yos it in and out of the a11y tree and can
 *     drop or duplicate announcements. A always-present, off-screen
 *     `aria-live` node owned solely by the mirror gives a single,
 *     predictable announcement channel.
 *
 * Keyboard seam (documented, not built here): the chart does not yet
 * have a keyboard cursor — hover is pointer-driven. A keyboard user
 * cannot currently move the cell focus without a mouse. When a keyboard
 * cursor lands (arrow-key cell navigation), it should drive the SAME
 * engine cursor channel (`engine.setCursor` / a future
 * `engine.setCursorCell`), at which point this mirror announces
 * keyboard-driven cell changes for free — no change needed here. Until
 * then this mirror serves pointer + touch users; the gap is recorded in
 * AGENT_NOTES.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useFootprintCursor } from '@/lib/chart/use-footprint-cursor';
import {
  cellReadoutKey,
  formatCellReadoutSr,
} from '@/lib/chart/cell-readout';

export function CellReadoutMirror(): ReactNode {
  const cursor = useFootprintCursor();
  const [message, setMessage] = useState('');
  // Last announced cell key — the throttle gate. We only rebuild the
  // sentence when the key changes, never on px-only cursor updates.
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (cursor === null) {
      // Cursor left the chart — clear so we do not re-announce stale
      // data, and reset the key so re-entering the same cell announces
      // again.
      if (lastKeyRef.current !== null) {
        lastKeyRef.current = null;
        setMessage('');
      }
      return;
    }
    const key = cellReadoutKey(cursor.cell);
    if (key === lastKeyRef.current) return; // same cell — stay silent
    lastKeyRef.current = key;
    setMessage(formatCellReadoutSr(cursor.cell, cursor.data));
  }, [cursor]);

  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </span>
  );
}
