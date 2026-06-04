import {
  bucketTsToX,
  cellWidthOf,
  chartConfig,
  priceToY,
  type BarRegion,
  type ChartScale,
} from '../scale';

export interface AxisPalette {
  tick: string;
  label: string;
  /** Resolved monospace family for `ctx.font` (P0-3). */
  fontMono: string;
}

/**
 * Y-axis (prices) on the right, X-axis (UTC times) at the bottom.
 *
 * Y axis:
 *   - Ticks at the same rows as the horizontal grid (every Nth price
 *     bucket). The renderer's `priceBucket` is a row INDEX (see
 *     `scale.ts` ChartScale docblock); the label multiplies the
 *     INDEX by `priceBucketSize` to recover the USD price for
 *     display. Format precision follows the bucket-size step.
 *
 * X axis:
 *   - Ticks at 5-minute UTC boundaries. Labels are `HH:MM`. We walk
 *     bars from the right, sample every 5th (5 min for 1-min bars),
 *     and only render a label when the bucket's wall time is divisible
 *     by 5 minutes — so the labels stay aligned to clock-hour
 *     boundaries even as new bars roll in.
 */
export function paintAxes(
  ctx: CanvasRenderingContext2D,
  barRegion: BarRegion,
  axisXRegion: BarRegion,
  axisYRegion: BarRegion,
  scale: ChartScale,
  palette: AxisPalette,
  dpr: number,
): void {
  ctx.lineWidth = 1 / dpr;
  const snap = 0.5 / dpr;

  // ---- Y axis ----
  ctx.strokeStyle = palette.tick;
  ctx.beginPath();
  ctx.moveTo(Math.round(axisYRegion.x) + snap, axisYRegion.y);
  ctx.lineTo(Math.round(axisYRegion.x) + snap, axisYRegion.y + axisYRegion.h);
  ctx.stroke();

  ctx.fillStyle = palette.label;
  ctx.font = `${chartConfig.axisFontSize}px ${palette.fontMono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const yStride = Math.max(
    1,
    Math.ceil(48 / chartConfig.cellHeight),
  );
  const centreRow = 0;
  const maxRow = Math.ceil(barRegion.h / 2 / chartConfig.cellHeight) + 1;
  for (let row = -maxRow; row <= maxRow; row += yStride) {
    if (row === centreRow) {
      // Always show the centre price.
    }
    // priceBucket is an INDEX — each row is one step regardless of
    // priceBucketSize (the USD-per-row factor only enters the label).
    const priceBucket = scale.priceMid + row;
    const py = priceToY(scale, priceBucket);
    if (py < barRegion.y || py > barRegion.y + barRegion.h) continue;
    // Small tick mark.
    ctx.strokeStyle = palette.tick;
    ctx.beginPath();
    ctx.moveTo(axisYRegion.x, Math.round(py) + snap);
    ctx.lineTo(axisYRegion.x + 4, Math.round(py) + snap);
    ctx.stroke();
    ctx.fillText(
      formatPrice(priceBucket * scale.priceBucketSize, scale.priceBucketSize),
      axisYRegion.x + 7,
      py,
    );
  }

  // ---- X axis ----
  ctx.strokeStyle = palette.tick;
  ctx.beginPath();
  ctx.moveTo(axisXRegion.x, Math.round(axisXRegion.y) + snap);
  ctx.lineTo(
    axisXRegion.x + axisXRegion.w,
    Math.round(axisXRegion.y) + snap,
  );
  ctx.stroke();

  ctx.fillStyle = palette.label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // 5-minute label cadence. We sample every bar and only render
  // labels whose bucket falls on a 5-minute boundary, so the labels
  // stay clock-aligned across scroll.
  const cw = cellWidthOf(scale);
  const visibleBars = Math.ceil(barRegion.w / cw) + 2;
  const labelEveryMs = 5 * 60_000;
  for (let i = 0; i < visibleBars; i++) {
    const ts = scale.latestBucketTs - i * scale.barDurationMs;
    if (ts % labelEveryMs !== 0) continue;
    const x = bucketTsToX(scale, ts) + cw / 2;
    if (x < axisXRegion.x || x > axisXRegion.x + axisXRegion.w) continue;
    // Tick.
    ctx.strokeStyle = palette.tick;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + snap, axisXRegion.y);
    ctx.lineTo(Math.round(x) + snap, axisXRegion.y + 4);
    ctx.stroke();
    ctx.fillStyle = palette.label;
    ctx.fillText(formatTimeUtc(ts), x, axisXRegion.y + 6);
  }
}

/**
 * Two-digit zero-padded UTC `HH:MM`. We do not use `toLocaleTimeString`
 * because the trader-terminal vibe wants explicit UTC, not the
 * viewer's wall clock.
 */
function formatTimeUtc(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatPrice(price: number, bucketSize: number): string {
  // Sub-1 bucket sizes (e.g. ETH or low-cap perps) want a decimal.
  if (bucketSize < 1) {
    return price.toFixed(2);
  }
  if (bucketSize < 10) {
    return price.toFixed(0);
  }
  return Math.round(price).toString();
}
