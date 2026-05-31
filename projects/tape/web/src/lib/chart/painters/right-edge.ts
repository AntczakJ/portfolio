import { chartConfig, type BarRegion } from '../scale';
import type { WSTickPayload } from 'tape-server';

export interface StripPalette {
  bid: string;
  ask: string;
  label: string;
}

/**
 * "Live tape strip" rendered as a vertical micro-list of
 * `price qty` rows along the right edge of the bar grid.
 *
 * The most recent tick lands at the BOTTOM of the strip (closest to
 * `now` reads naturally as "latest = nearest the time axis"). We
 * walk backward through the ticks so the oldest visible row is at
 * the top. Each row is bid-coloured if the aggressor was a seller,
 * ask-coloured if the aggressor was a buyer.
 *
 * Phase 3.1 — paints the strip as a column. The "Follow live" hint
 * pinned in the top-right corner of the strip surfaces only when
 * `scrollX !== 0`; it is text-only (no button styling) per the brief.
 * Phase 3.2 wires the click handler.
 */
export function paintRightEdge(
  ctx: CanvasRenderingContext2D,
  region: BarRegion,
  ticks: WSTickPayload[],
  palette: StripPalette,
  followLiveVisible: boolean,
): void {
  if (region.h <= 0) return;

  ctx.font = `${chartConfig.stripFontSize}px var(--font-mono), ui-monospace, monospace`;
  ctx.textBaseline = 'middle';

  // Available row count given the row height.
  const rowH = chartConfig.stripRowHeight;
  const rows = Math.max(0, Math.floor((region.h - 4) / rowH));
  if (rows === 0) return;

  // Slice to the visible window. Most-recent is the LAST element of
  // `ticks` per the stream store convention.
  const slice = ticks.slice(-rows);

  // Two batched passes — one per side. Pre-bin the rows by aggressor
  // so each pass sets `fillStyle` once.
  const bottomY = region.y + region.h - rowH / 2 - 2;

  // Pass 1: bid (seller-aggressed) — m === true in Binance terms.
  ctx.fillStyle = palette.bid;
  ctx.textAlign = 'right';
  for (let i = 0; i < slice.length; i++) {
    const tick = slice[slice.length - 1 - i]!;
    if (tick.aggressor !== 'sell') continue;
    const y = bottomY - i * rowH;
    if (y < region.y) break;
    ctx.fillText(formatPrice(tick.price), region.x + region.w * 0.55, y);
    ctx.textAlign = 'left';
    ctx.fillText(
      formatQty(tick.qty),
      region.x + region.w * 0.6,
      y,
    );
    ctx.textAlign = 'right';
  }

  // Pass 2: ask (buyer-aggressed).
  ctx.fillStyle = palette.ask;
  ctx.textAlign = 'right';
  for (let i = 0; i < slice.length; i++) {
    const tick = slice[slice.length - 1 - i]!;
    if (tick.aggressor !== 'buy') continue;
    const y = bottomY - i * rowH;
    if (y < region.y) break;
    ctx.fillText(formatPrice(tick.price), region.x + region.w * 0.55, y);
    ctx.textAlign = 'left';
    ctx.fillText(
      formatQty(tick.qty),
      region.x + region.w * 0.6,
      y,
    );
    ctx.textAlign = 'right';
  }

  // "Follow live" affordance — text-only, top-right of the strip.
  if (followLiveVisible) {
    ctx.fillStyle = palette.label;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(
      'Follow live',
      region.x + region.w - 2,
      region.y + 2,
    );
  }
}

function formatPrice(price: number): string {
  // Compact integer for headline pricing. BTC-PERP is comfortable as
  // integer dollars at this strip width.
  return Math.round(price).toString();
}

function formatQty(qty: number): string {
  if (qty < 0.1) return qty.toFixed(3);
  if (qty < 10) return qty.toFixed(2);
  if (qty < 1000) return qty.toFixed(1);
  return Math.round(qty).toString();
}
