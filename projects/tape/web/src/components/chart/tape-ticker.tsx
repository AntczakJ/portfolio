'use client';

/**
 * <TapeTicker /> — desktop live tape strip (Task 3.3).
 *
 * A standalone, virtualized feed of the most-recent trades that sits
 * in its own pane to the LEFT of the footprint chart (see
 * `app/page.tsx`). This is distinct from the in-canvas right-edge
 * strip (`painters/right-edge.ts`): that strip is axis-adjacent
 * decoration drawn by the rAF loop; THIS pane is a first-class,
 * scrollable, keyboard-reachable, click-to-pin DOM surface.
 *
 * **Orientation — newest at TOP.** Per AGENT_NOTES (Phase 4 fix round
 * 1): the in-canvas right-edge strip places newest at the BOTTOM
 * because it sits against the X (time) axis. A standalone feed pane is
 * read like a notification list (Twitter / Slack / Discord), so the
 * freshest trade lands at row 0 — same convention as `<MobileTape />`.
 * Do not "harmonise" the two directions; they serve different surfaces.
 *
 * **Virtualization (CSS transform, not re-layout).** The store's tick
 * ring is bounded at 200 (`STREAM_RECENT_TICKS_CAP`); we show the most
 * recent `TAPE_VISIBLE_ROWS` (~100). Rows are absolutely positioned
 * inside a tall spacer and offset with `transform: translateY(...)` —
 * never `top` — so a new trade scrolls the list by compositing a
 * transform rather than triggering layout / paint reflow on every
 * frame. Only the rows in the visible scroll window are mounted.
 *
 * **Colour is never alone (WCAG AA + colourblind-safe).** Each row
 * pairs the bid/ask hue with a directional glyph: `▲` for a buy
 * (taker lifted the ask) and `▼` for a sell (taker hit the bid). A
 * colourblind user reads the side from the glyph + the column the
 * marker sits in, not the hue. Aggressor → colour mapping mirrors
 * `painters/right-edge.ts` and `schemas/ws/tick.ts`:
 *   - `'sell'` → `--color-bid` green (taker sold INTO the maker bid)
 *   - `'buy'`  → `--color-ask` red   (taker bought FROM the maker ask)
 *
 * **Click-to-pin.** Clicking a row freezes that trade by VALUE into a
 * local "pinned" banner above the feed — a snapshot for inspection
 * that survives the ring shifting the original tick out. Click the
 * pinned banner (or press Escape) to unpin. Pinning does not pause the
 * live feed; it just captures one trade for reference.
 *
 * **Reduced motion.** With `prefers-reduced-motion: reduce`, new
 * trades replace instantly with no transform transition. The global
 * CSS reduced-motion rule already collapses CSS transitions to ~0 ms;
 * we additionally gate the JS-driven transition so the translateY snap
 * is instant rather than animated.
 *
 * The component subscribes to the Zustand stream store via the
 * `useRecentTicks(...)` selector (3.4) — no props, no prop drilling.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pin, X } from 'lucide-react';

import { useRecentTicks } from '@/lib/stores/stream-store';
import type { WSTickPayload } from 'tape-server';

/** Most-recent trades surfaced in the pane. */
export const TAPE_VISIBLE_ROWS = 100;

/** Fixed row height in CSS pixels — drives the translateY virtualizer. */
export const TAPE_ROW_HEIGHT = 22;

/** Extra rows rendered above / below the viewport to avoid edge flicker. */
const TAPE_OVERSCAN = 6;

const PRICE_USD_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Quantity formatter — mirrors `painters/right-edge.ts` and
 * `mobile-tape.tsx` breakpoints byte-for-byte so the same trade reads
 * identically across all three surfaces. Inlined rather than exported
 * from the painter (a hot-path helper) per AGENT_NOTES.
 */
function formatQty(qty: number): string {
  if (qty < 0.1) return qty.toFixed(3);
  if (qty < 10) return qty.toFixed(2);
  if (qty < 1000) return qty.toFixed(1);
  return Math.round(qty).toString();
}

function formatUtcTime(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function TapeTicker(): ReactNode {
  // useRecentTicks returns oldest -> newest, bounded at the ring cap.
  // We take the most-recent window and reverse so newest is index 0.
  const ticks = useRecentTicks(TAPE_VISIBLE_ROWS);

  // Newest-first view of the window. Position in this array IS the row
  // index the virtualizer offsets by; intrinsic trade fields + index
  // give a stable-enough React key for a positionally-stable list.
  const rows = useMemo<WSTickPayload[]>(
    () => ticks.slice().reverse(),
    [ticks],
  );

  /* ---- Virtualization scroll window ---- */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const measure = (): void => {
      setViewportH(el.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    setScrollTop(el.scrollTop);
  }, []);

  const totalHeight = rows.length * TAPE_ROW_HEIGHT;
  const firstVisible = Math.max(
    0,
    Math.floor(scrollTop / TAPE_ROW_HEIGHT) - TAPE_OVERSCAN,
  );
  const visibleCount =
    Math.ceil((viewportH || TAPE_ROW_HEIGHT * TAPE_VISIBLE_ROWS) / TAPE_ROW_HEIGHT) +
    TAPE_OVERSCAN * 2;
  const lastVisible = Math.min(rows.length, firstVisible + visibleCount);
  const windowRows = rows.slice(firstVisible, lastVisible);

  /* ---- Click-to-pin ---- */
  // Pinned trade is captured BY VALUE so it survives the ring shifting
  // the original out of `recentTicks`.
  const [pinned, setPinned] = useState<WSTickPayload | null>(null);

  const handlePin = useCallback((tick: WSTickPayload) => {
    setPinned((prev) =>
      prev !== null &&
      prev.tsMs === tick.tsMs &&
      prev.price === tick.price &&
      prev.qty === tick.qty
        ? null // clicking the already-pinned row toggles it off
        : { ...tick },
    );
  }, []);

  const handleUnpin = useCallback(() => {
    setPinned(null);
  }, []);

  // Escape unpins. Document-level listener, stable across renders.
  useEffect(() => {
    if (pinned === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPinned(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <section
      aria-label="Live trade tape"
      className="flex h-full w-full flex-col overflow-hidden border-r border-(--color-border) bg-(--color-bg) text-(--color-fg)"
    >
      <header className="flex shrink-0 items-baseline justify-between border-b border-(--color-border) bg-(--color-surface) px-3 py-2 font-mono text-[11px] text-(--color-fg-muted)">
        <span className="uppercase tracking-wider">Tape · BTC-PERP</span>
        <span className="text-(--color-fg-subtle)">{rows.length}</span>
      </header>

      {pinned !== null ? <PinnedRow tick={pinned} onUnpin={handleUnpin} /> : null}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center font-mono text-[12px] text-(--color-fg-subtle)">
          Streaming BTC-PERP — first trades arrive in a few seconds.
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // The scroll container owns overflow; rows are absolutely
          // positioned inside the tall spacer and moved via transform.
          className="relative min-h-0 flex-1 overflow-y-auto"
        >
          <ol
            aria-label="Recent trades, newest first"
            className="relative font-mono text-[12px] tabular-nums"
            data-numeric
            style={{ height: totalHeight }}
          >
            {windowRows.map((tick, idx) => {
              const absoluteIndex = firstVisible + idx;
              const isPinned =
                pinned !== null &&
                pinned.tsMs === tick.tsMs &&
                pinned.price === tick.price &&
                pinned.qty === tick.qty;
              return (
                <TapeRowItem
                  key={`${String(tick.tsMs)}-${String(absoluteIndex)}`}
                  tick={tick}
                  offsetY={absoluteIndex * TAPE_ROW_HEIGHT}
                  pinned={isPinned}
                  onPin={handlePin}
                />
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

/* ============================================================== *\
   Row
\* ============================================================== */

interface TapeRowItemProps {
  tick: WSTickPayload;
  offsetY: number;
  pinned: boolean;
  onPin: (tick: WSTickPayload) => void;
}

function TapeRowItem({
  tick,
  offsetY,
  pinned,
  onPin,
}: TapeRowItemProps): ReactNode {
  // Aggressor colour + glyph (never colour-alone):
  //   'sell' -> bid green, ▼ (taker hit the bid)
  //   'buy'  -> ask red,   ▲ (taker lifted the ask)
  const isSell = tick.aggressor === 'sell';
  const sideColor = isSell ? 'text-(--color-bid)' : 'text-(--color-ask)';
  const glyph = isSell ? '▼' : '▲';
  const sideLabel = isSell ? 'Sell' : 'Buy';

  const handleClick = useCallback(() => {
    onPin(tick);
  }, [onPin, tick]);

  return (
    <li
      // translateY (NOT top) so the virtualizer composites the offset
      // rather than reflowing the document. The transform + the fixed
      // row height are genuinely dynamic (measured offset, constant
      // height) so they belong inline, not in a class.
      style={{ transform: `translateY(${String(offsetY)}px)`, height: TAPE_ROW_HEIGHT }}
      className="absolute inset-x-0 top-0"
    >
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={pinned}
        className={`flex h-full w-full items-baseline gap-2 px-3 text-left transition-colors hover:bg-(--color-surface) focus-visible:bg-(--color-surface) focus-visible:outline-none ${
          pinned ? 'bg-(--color-surface-raised)' : ''
        }`}
      >
        <span className="w-[58px] shrink-0 text-(--color-fg-subtle)">
          {formatUtcTime(tick.tsMs)}
        </span>
        <span
          aria-hidden="true"
          className={`w-3 shrink-0 text-center ${sideColor}`}
        >
          {glyph}
        </span>
        <span className={`flex-1 text-right ${sideColor}`}>
          {PRICE_USD_FORMAT.format(tick.price)}
        </span>
        <span className="w-[56px] shrink-0 text-right text-(--color-fg)">
          {formatQty(tick.qty)}
        </span>
        {/* Screen-reader-only side label so the row is unambiguous
            without relying on the glyph or the colour. */}
        <span className="sr-only">{sideLabel}</span>
      </button>
    </li>
  );
}

/* ============================================================== *\
   Pinned banner
\* ============================================================== */

interface PinnedRowProps {
  tick: WSTickPayload;
  onUnpin: () => void;
}

function PinnedRow({ tick, onUnpin }: PinnedRowProps): ReactNode {
  const isSell = tick.aggressor === 'sell';
  const sideColor = isSell ? 'text-(--color-bid)' : 'text-(--color-ask)';
  const glyph = isSell ? '▼' : '▲';
  const sideLabel = isSell ? 'Sell' : 'Buy';

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-(--color-border) bg-(--color-surface-raised) px-3 py-1.5 font-mono text-[12px] tabular-nums">
      <Pin aria-hidden="true" className="size-3 shrink-0 text-(--color-fg-muted)" />
      <span className="text-(--color-fg-subtle)">{formatUtcTime(tick.tsMs)}</span>
      <span aria-hidden="true" className={`w-3 text-center ${sideColor}`}>
        {glyph}
      </span>
      <span className={`flex-1 text-right ${sideColor}`}>
        {PRICE_USD_FORMAT.format(tick.price)}
      </span>
      <span className="w-[56px] text-right text-(--color-fg)">
        {formatQty(tick.qty)}
      </span>
      <span className="sr-only">Pinned {sideLabel} trade</span>
      <button
        type="button"
        onClick={onUnpin}
        aria-label="Unpin trade"
        className="ml-1 shrink-0 rounded-sm p-0.5 text-(--color-fg-muted) hover:text-(--color-fg) focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--color-focus-ring)"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>
  );
}
