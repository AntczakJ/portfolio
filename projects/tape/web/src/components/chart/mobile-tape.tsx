'use client';

/**
 * <MobileTape /> — tape-only fallback rendered below the `md` (768 px)
 * breakpoint, mounted alongside `<FootprintChart />` and gated by
 * mutually-exclusive `hidden md:block` / `md:hidden` classes so both
 * branches exist in the SSR HTML (no hydration mismatch).
 *
 * Why this exists:
 *   PLAN.md success criteria committed to a "mobile-first responsive
 *   from 320 px, chart degrades to single-column tape-only view below
 *   768 px". The Canvas2D footprint chart paints fine at 320 px
 *   width but reads as broken — bar region is ~176 px wide after
 *   chrome reservations, only ~7 bars visible, cells crushed.
 *   Recruiters opening the demo URL on a phone see a broken chart
 *   rather than a deliberately mobile-optimized surface. This
 *   component closes the gap by rendering the recent trade list
 *   directly — the data is there (Zustand `useRecentTicks(...)`),
 *   we just present it differently per breakpoint.
 *
 * Why newest-at-top (vs the desktop tape strip's newest-at-bottom):
 *   Desktop tape strip is bottom-anchored because that matches
 *   trader-terminal convention ("the time axis is below, so newest =
 *   nearest the axis"). Mobile users do NOT read it through that
 *   lens — they scroll a vertical feed with the expectation that
 *   the freshest row is at the top (Twitter / Slack / Discord
 *   notification pattern). Different surface, different convention.
 *   Documented here so a future "harmonization" pass does not flip
 *   the order to match desktop.
 *
 * Phase 3.2 cursor / tooltip wiring is intentionally not extended
 * to this surface — the chart cursor is a desktop affordance, the
 * mobile tape is a passive read-only feed.
 */
import type { ReactNode } from 'react';

import { useRecentTicks } from '@/lib/stores/stream-store';

/** Window of recent ticks shown in the mobile feed. */
const MOBILE_TICK_WINDOW = 30;

/**
 * Fixed row height (px). The feed is positioned by `transform: translateY` on a
 * fixed-height grid (NOT normal flow) so that prepending the freshest trade at
 * row 0 re-assigns transforms WITHOUT a layout reflow. A flow list reflowed
 * every visible row down ~31 px on every incoming tick (~6-8/sec), which is the
 * single largest Cumulative Layout Shift source on the deployed demo (CLS ~0.3+
 * at the Lighthouse mobile width, where this component renders). Transform
 * changes are composited, not layout — zero CLS while the feed streams.
 */
const MOBILE_ROW_H = 30;

const PRICE_USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Quantity formatter mirrors `painters/right-edge.ts` `formatQty` —
 * re-implemented inline rather than exported because the canvas
 * formatter is a hot-path helper and the DOM consumer is a different
 * lifecycle. Match the breakpoints byte-for-byte so the same trade
 * reads identically on mobile and desktop strips.
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

export function MobileTape(): ReactNode {
  // useRecentTicks returns oldest→newest. We iterate from the tail
  // (newest) so the freshest tick lands at row 0 of the DOM feed.
  const ticks = useRecentTicks(MOBILE_TICK_WINDOW);
  const reversed = ticks.slice().reverse();

  return (
    <section
      aria-label="Recent trades (mobile view)"
      className="flex h-full w-full flex-col overflow-hidden bg-(--color-bg) text-(--color-fg)"
    >
      <header className="flex shrink-0 items-baseline justify-between border-b border-(--color-border) bg-(--color-surface) px-3 py-2 font-mono text-[11px] text-(--color-fg-muted)">
        <span className="uppercase tracking-wider">Tape · BTC-PERP</span>
        {/* Reserve the count box so "0 recent" -> "30 recent" does not
            reflow the header when ticks arrive. */}
        <span className="inline-block min-w-[9ch] text-right tabular-nums text-(--color-fg-subtle)">
          {reversed.length} recent
        </span>
      </header>

      {reversed.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center font-mono text-[12px] text-(--color-fg-subtle)">
          Streaming BTC-PERP — first trades arrive in a few seconds.
        </div>
      ) : (
        // Transform-positioned feed (NOT a flow list) so prepending the newest
        // trade never reflows the rows below it — the deploy's largest CLS source.
        // Each row is absolutely placed at `translateY(index * MOBILE_ROW_H)`; a
        // new tick at index 0 shifts every row's transform by one row, which the
        // browser composites without a layout shift.
        <ol
          className="relative flex-1 overflow-hidden font-mono text-[12px] tabular-nums"
          data-numeric
          style={{ contain: 'strict' }}
        >
          {reversed.map((tick, index) => {
            // Aggressor color convention (matches the canvas strip):
            //   'sell' → bid green (taker sold into the maker bid).
            //   'buy'  → ask red   (taker bought from the maker ask).
            // See `src/lib/schemas/ws/tick.ts` for the canonical
            // aggressor / m-flag mapping.
            const sideColor =
              tick.aggressor === 'sell'
                ? 'text-(--color-bid)'
                : 'text-(--color-ask)';
            const rowKey = `${tick.tsMs}-${tick.price}-${tick.qty}`;
            return (
              <li
                key={rowKey}
                className="absolute inset-x-0 top-0 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-(--color-border) px-3"
                style={{
                  height: MOBILE_ROW_H,
                  transform: `translateY(${String(index * MOBILE_ROW_H)}px)`,
                }}
              >
                <span className="text-(--color-fg-subtle)">
                  {formatUtcTime(tick.tsMs)}
                </span>
                <span className={`text-right ${sideColor}`}>
                  {PRICE_USD_FORMAT.format(tick.price)}
                </span>
                <span className="text-right text-(--color-fg)">
                  {formatQty(tick.qty)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
