'use client';

/**
 * <CellTooltip /> — floating tooltip surface for the hovered footprint
 * cell (Phase 3.2).
 *
 * Subscribes to ONE engine channel — the cursor subscriber — via the
 * `useFootprintCursor()` hook. Re-renders only when the cell under the
 * cursor changes (NOT on every pointer move — the engine's
 * `setCursor` no-ops when coords are unchanged, and even when coords
 * change to a NEW pixel inside the SAME cell, only the px field
 * updates so we use `useShallow`-equivalent caching on the cell
 * identity to skip renders).
 *
 * Positioning:
 *   - Anchored to the cursor position with a 14 px offset to the
 *     right + 14 px below (so it does not sit under the cursor).
 *   - Viewport-clamped via the measured tooltip rect on render: if the
 *     anchored position would overflow the chart container, we flip
 *     horizontally (move to the left side of the cursor) and / or
 *     vertically (above the cursor). A 12 px safe margin to the
 *     container edges keeps the tooltip readable even at the corners.
 *
 * Aria (Task 3.5 split):
 *   - This tooltip is now PURELY VISUAL — `aria-hidden="true"`. It
 *     repositions on every pointer move (the `px` field changes), which
 *     would spam an `aria-live` region. Screen-reader announcement is
 *     owned by the dedicated `<CellReadoutMirror />`, which throttles to
 *     one announcement per CELL change (keyed on
 *     `${bucketTs}:${priceBucket}`), not one per pointer move. Splitting
 *     the visual surface from the SR surface keeps the live region
 *     quiet under rapid cursor movement.
 *
 * Motion:
 *   - Fade in / out at 120 ms via plain CSS opacity transition (no
 *     transform — keeps the per-frame compositor cost trivial; the
 *     chart is the perf-sensitive sibling).
 *   - `prefers-reduced-motion` collapses the transition to 0 ms.
 *
 * No business logic:
 *   - All math (imbalance %) comes from `lib/chart/cells.ts`. The
 *     tooltip only formats values — Intl.NumberFormat for thousands
 *     separators, a tiny UTC HH:MM:SS formatter for the bucket time.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';

import { useFootprintCursor } from '@/lib/chart/use-footprint-cursor';
import {
  computeImbalance,
  type NormalizedCell,
} from '@/lib/chart/cells';
import { DEFAULT_PRICE_BUCKET_SIZE } from '@/lib/chart/footprint-engine';

/** Margin in CSS pixels from the container edge — readable corners. */
const VIEWPORT_MARGIN = 12;

/** Cursor offset — tooltip sits to the lower-right of the cursor by
 * default before the viewport-clamp algorithm runs. */
const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 14;

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const VOLUME_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/**
 * USD formatter for the price row. `priceBucket` flows through the
 * chart as an INDEX (see `DEFAULT_PRICE_BUCKET_SIZE` docblock); we
 * multiply back to dollars and render with the standard `$71,230.00`
 * shape so the tooltip matches the axis painter's USD label format
 * rather than leaking the internal index unit to the user.
 */
const PRICE_USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface CellTooltipProps {
  /**
   * Container element the tooltip is positioned within. Required for
   * the viewport-clamp math — `cursorPx` is relative to the container,
   * so we need its measured size to flip the tooltip when anchored
   * placement would overflow.
   *
   * Pass the chart's relative-positioned wrapper ref. The tooltip
   * portals nothing — it renders as a sibling absolute-positioned
   * element inside the same container.
   */
  containerRef: React.RefObject<HTMLElement | null>;
}

export function CellTooltip({ containerRef }: CellTooltipProps): ReactNode {
  const cursor = useFootprintCursor();
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

  // Reposition on every cursor update. We read the tooltip's measured
  // box via `getBoundingClientRect` AFTER the layout that just painted
  // — that's why this lives in a useEffect rather than a render-time
  // computation. The cost is one rAF-equivalent on the React side per
  // cursor change.
  useEffect(() => {
    if (cursor === null) return;
    const tooltip = tooltipRef.current;
    const container = containerRef.current;
    if (tooltip === null || container === null) return;

    const containerRect = container.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    setPosition(
      clampToContainer({
        cursorX: cursor.px.x,
        cursorY: cursor.px.y,
        containerW: containerRect.width,
        containerH: containerRect.height,
        tooltipW: tooltipRect.width,
        tooltipH: tooltipRect.height,
      }),
    );
  }, [cursor, containerRef]);

  const visible = cursor !== null;
  const data = cursor?.data ?? null;
  const transitionMs = reduceMotion === true ? 0 : 120;

  return (
    <div
      ref={tooltipRef}
      aria-hidden="true"
      data-testid="cell-tooltip"
      // Always rendered so it can be measured. Pointer events disabled
      // so it never steals hover from the canvas. SR announcement is
      // handled by <CellReadoutMirror />, not here (Task 3.5) — this
      // surface is visual-only and `aria-hidden`.
      className={[
        'pointer-events-none absolute z-20 min-w-[180px] rounded-md',
        'border border-(--color-grid) bg-(--color-surface)/90 px-2 py-1.5',
        'font-mono text-[11px] leading-tight text-(--color-fg)',
        'shadow-lg backdrop-blur-sm',
      ].join(' ')}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        opacity: visible ? 1 : 0,
        transition: `opacity ${transitionMs}ms ease-out`,
        // Hidden tooltips should not announce stale content again on
        // hide — clear the text node when invisible so aria-live does
        // not re-narrate.
        visibility: visible ? 'visible' : 'hidden',
      }}
    >
      {visible && cursor !== null ? (
        <TooltipBody cell={cursor.cell} data={data} />
      ) : null}
    </div>
  );
}

interface TooltipBodyProps {
  cell: { bucketTs: number; priceBucket: number };
  data: NormalizedCell | null;
}

function TooltipBody({ cell, data }: TooltipBodyProps): ReactNode {
  const bidVolume = data?.bidVolume ?? 0;
  const askVolume = data?.askVolume ?? 0;
  const trades = data?.trades ?? 0;
  const delta = askVolume - bidVolume; // buy-aggression positive (matches AGENT_NOTES)
  const imbalance = data === null ? 0 : computeImbalance(data);
  const imbalancePct = imbalance * 100;

  const deltaColorClass = signColorClass(delta);
  const imbalanceColorClass = signColorClass(imbalance);

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
      <dt className="text-(--color-fg-subtle)">Time</dt>
      <dd className="text-right">{formatUtcTime(cell.bucketTs)} UTC</dd>

      <dt className="text-(--color-fg-subtle)">Price</dt>
      <dd className="text-right">
        {PRICE_USD_FORMAT.format(cell.priceBucket * DEFAULT_PRICE_BUCKET_SIZE)}
      </dd>

      <dt className="text-(--color-fg-subtle)">Bid vol</dt>
      <dd className="text-right">{VOLUME_FORMAT.format(bidVolume)}</dd>

      <dt className="text-(--color-fg-subtle)">Ask vol</dt>
      <dd className="text-right">{VOLUME_FORMAT.format(askVolume)}</dd>

      <dt className="text-(--color-fg-subtle)">Trades</dt>
      <dd className="text-right">{NUMBER_FORMAT.format(trades)}</dd>

      <dt className="text-(--color-fg-subtle)">Delta</dt>
      <dd className={`text-right ${deltaColorClass}`}>
        {formatSigned(delta)}
      </dd>

      <dt className="text-(--color-fg-subtle)">Imbalance</dt>
      <dd className={`text-right ${imbalanceColorClass}`}>
        {data === null ? '—' : `${formatSigned(imbalancePct, 1)}%`}
      </dd>
    </dl>
  );
}

function signColorClass(value: number): string {
  if (value > 0) return 'text-(--color-bid)';
  if (value < 0) return 'text-(--color-ask)';
  return 'text-(--color-fg-muted)';
}

function formatSigned(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(fractionDigits)}`;
}

function formatUtcTime(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Pure viewport-clamp rule:
 *
 *   - Default placement: lower-right of the cursor (+OFFSET on both
 *     axes).
 *   - If that overflows the right edge minus the safe margin, flip
 *     horizontally — anchor the tooltip's right edge to `cursorX -
 *     OFFSET`.
 *   - If that ALSO overflows the bottom edge, flip vertically —
 *     anchor the tooltip's bottom edge to `cursorY - OFFSET`.
 *   - As a last resort (small viewports), the result is clamped to
 *     stay at least `VIEWPORT_MARGIN` inside the container so the
 *     tooltip remains fully visible even on a 320 px-wide layout.
 *
 * Exported for unit tests.
 */
export function clampToContainer(args: {
  cursorX: number;
  cursorY: number;
  containerW: number;
  containerH: number;
  tooltipW: number;
  tooltipH: number;
}): { left: number; top: number } {
  const { cursorX, cursorY, containerW, containerH, tooltipW, tooltipH } =
    args;

  let left = cursorX + CURSOR_OFFSET_X;
  let top = cursorY + CURSOR_OFFSET_Y;

  // Horizontal flip — would overflow the right edge.
  if (left + tooltipW > containerW - VIEWPORT_MARGIN) {
    left = cursorX - CURSOR_OFFSET_X - tooltipW;
  }
  // Vertical flip — would overflow the bottom edge.
  if (top + tooltipH > containerH - VIEWPORT_MARGIN) {
    top = cursorY - CURSOR_OFFSET_Y - tooltipH;
  }

  // Final clamp against the container box. Right/bottom clamps run
  // FIRST so that on a normal-sized container the tooltip is pulled
  // back inside the right + bottom margins; the min-margin clamp
  // runs LAST so that on a tiny container (tooltip wider than
  // container) we pin to the left/top margin and accept the inevitable
  // right-edge overflow rather than producing a negative coord.
  if (left + tooltipW > containerW - VIEWPORT_MARGIN) {
    left = containerW - VIEWPORT_MARGIN - tooltipW;
  }
  if (top + tooltipH > containerH - VIEWPORT_MARGIN) {
    top = containerH - VIEWPORT_MARGIN - tooltipH;
  }
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

  return { left, top };
}
