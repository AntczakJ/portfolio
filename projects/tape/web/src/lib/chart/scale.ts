/**
 * Viewport + scale model for the footprint chart.
 *
 * The chart is conceptually a 2D grid: bars on the X axis (one bar per
 * 60 s UTC-aligned bucket), price levels on the Y axis (one row per
 * price bucket). Pixel size of a cell is FIXED in v1 — the scale
 * function is a deterministic linear map from (bucketTs, priceBucket)
 * to (px, py) inside the viewport rectangle.
 *
 * Why fixed cell sizes:
 *   - Determinism: the chart's layout depends only on `viewport` and
 *     `scrollX`. No "fit-to-window" heuristic that the user has to
 *     re-learn after each resize.
 *   - Frame budget: we can pre-compute axis tick positions and cell
 *     batches per scroll position without measuring per-frame text.
 *   - Phase 3.4 (zoom) is the right place to make `cellWidth` /
 *     `cellHeight` variable; v1 just paints at a sensible default.
 *
 * Pixel sizes chosen for v1 (24 x 16 px):
 *   - 24 px wide is wide enough for a 5–6 char volume label in
 *     JetBrains Mono at 10 px — covers `123` style integer volumes
 *     comfortably and elides cleanly when the cell carries `1.23K`
 *     style abbreviations.
 *   - 16 px tall is the minimum height that still hosts a 10 px font
 *     with 3 px breathing room top/bottom. Below this, monospaced
 *     digits start clipping descenders. At 16 px we also fit ~40
 *     price levels in a 640 px tall chart area — comfortable density
 *     for a $5-bucketed BTC-PERP range of ~200 price levels.
 *
 * Right edge:
 *   - When `scrollX === 0` the most recent bar is at the right edge
 *     of the viewport (minus the axis margin reserved for the price
 *     axis). Positive `scrollX` shifts the chart RIGHT, revealing
 *     older bars on the left side of the viewport.
 *   - The "live tape strip" lives in its own region to the RIGHT of
 *     the bars, between the bars and the price axis. That region is
 *     part of the viewport but is not part of the bar grid — the
 *     scale's `barIndexToX` formula leaves a fixed gap for it. See
 *     `chartConfig.rightStripWidth`.
 */

/**
 * Pixel rectangle inside the canvas. All coordinates are in CSS
 * pixels (NOT device pixels) — the engine applies `ctx.scale(dpr,
 * dpr)` once on every resize, so the painters can think in CSS
 * pixels exclusively.
 */
export interface Viewport {
  /** Top-left X (CSS pixels). */
  x: number;
  /** Top-left Y (CSS pixels). */
  y: number;
  /** Width (CSS pixels). */
  w: number;
  /** Height (CSS pixels). */
  h: number;
}

/**
 * Static layout constants — the same on every frame, do not depend
 * on data. Exported so tests can import them without inferring values
 * from drawn pixels.
 */
export const chartConfig = {
  /** Width of one footprint cell, CSS pixels. */
  cellWidth: 24,
  /** Height of one footprint cell, CSS pixels. */
  cellHeight: 16,
  /**
   * Vertical band reserved for the X axis (time labels) at the bottom
   * of the chart. CSS pixels.
   */
  axisXHeight: 22,
  /**
   * Horizontal band reserved for the Y axis (price labels) on the
   * right of the chart. CSS pixels.
   */
  axisYWidth: 56,
  /**
   * Width of the "live tape strip" region between the rightmost bar
   * and the price axis. The strip hosts the most recent ticks as a
   * vertical micro-list. CSS pixels.
   */
  rightStripWidth: 80,
  /**
   * Vertical padding inside the viewport, top and bottom, CSS pixels.
   */
  paddingY: 8,
  /**
   * Horizontal padding inside the viewport, left, CSS pixels. The
   * right side is handled by `axisYWidth + rightStripWidth` so we
   * only pad the left.
   */
  paddingLeft: 8,
  /**
   * Font size for cell text labels (CSS pixels). Below this size cell
   * text is skipped entirely.
   */
  cellFontSize: 10,
  /** Font size for axis labels (CSS pixels). */
  axisFontSize: 11,
  /** Font size for tape strip rows (CSS pixels). */
  stripFontSize: 10,
  /** Vertical row height for tape strip entries (CSS pixels). */
  stripRowHeight: 11,
} as const;

/**
 * Region of the viewport that hosts the bar grid (cells + grid +
 * cursor). Excludes the price axis on the right and the tape strip
 * region. The X axis at the bottom DOES exclude vertical space.
 */
export interface BarRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute the bar-grid region from a viewport. Splits off the price
 * axis on the right, the tape strip just inside that, and the X axis
 * at the bottom.
 */
export function computeBarRegion(vp: Viewport): BarRegion {
  return {
    x: vp.x + chartConfig.paddingLeft,
    y: vp.y + chartConfig.paddingY,
    w:
      vp.w -
      chartConfig.paddingLeft -
      chartConfig.rightStripWidth -
      chartConfig.axisYWidth,
    h: vp.h - chartConfig.paddingY * 2 - chartConfig.axisXHeight,
  };
}

/**
 * Right-edge tape strip region — sits just to the right of the bar
 * grid, just to the left of the price axis.
 */
export function computeStripRegion(vp: Viewport): BarRegion {
  const bar = computeBarRegion(vp);
  return {
    x: bar.x + bar.w,
    y: bar.y,
    w: chartConfig.rightStripWidth,
    h: bar.h,
  };
}

/**
 * Y-axis region (price labels) — sits at the rightmost edge.
 */
export function computeAxisYRegion(vp: Viewport): BarRegion {
  const strip = computeStripRegion(vp);
  return {
    x: strip.x + strip.w,
    y: strip.y,
    w: chartConfig.axisYWidth,
    h: strip.h,
  };
}

/**
 * X-axis region (time labels) — sits at the bottom of the bar grid,
 * spans only the bar grid width.
 */
export function computeAxisXRegion(vp: Viewport): BarRegion {
  const bar = computeBarRegion(vp);
  return {
    x: bar.x,
    y: bar.y + bar.h,
    w: bar.w,
    h: chartConfig.axisXHeight,
  };
}

/**
 * The chart's data scale. Pure mapping from
 * (bucketTs, priceBucket) to (px, py).
 *
 * **Unit convention (INDEX, end-to-end).** `priceBucket` on every
 * domain object — `WSCellDeltaPayload`, `WSCellClosePayload`,
 * `NormalizedCell`, `CursorCell` — is a **bucket index**, not a USD
 * price. It mirrors `worker/src/bucketing.rs::price_bucket`, which
 * floors `price / PRICE_BUCKET_USD`. `priceMid` is in the same units;
 * each step of `priceBucket` is exactly one row regardless of the
 * underlying $5 step in USD. `priceBucketSize` carries the USD-per-row
 * factor for the axis label formatter only — the render path does NOT
 * divide by it.
 *
 * Bar grid layout — RIGHT-ANCHORED:
 *   - The most recent bar (`latestBucketTs`) sits at the right edge of
 *     the bar region when `scrollX === 0`.
 *   - Positive `scrollX` shifts the visible window LEFT into history.
 *   - Bar at offset N from the right is at `barRegion.x + barRegion.w
 *     - (N + 1) * cellWidth + scrollX`.
 */
export interface ChartScale {
  barRegion: BarRegion;
  /** ms since epoch — the rightmost bar's bucket timestamp. */
  latestBucketTs: number;
  /** Length of one bar in ms (60_000 for 1-min bars). */
  barDurationMs: number;
  /** Centre row of the visible Y range, in `priceBucket` INDEX units. */
  priceMid: number;
  /**
   * USD width of one `priceBucket` step. Used by the axis label
   * formatter to render INDEX → USD; NOT consumed by `priceToY` /
   * `yToPriceBucket`, which are pure row-offset math.
   */
  priceBucketSize: number;
  /** Horizontal scroll in pixels (0 = pinned to live right edge). */
  scrollX: number;
}

/**
 * Project a bucket timestamp to its left-edge X coordinate inside the
 * bar grid, in CSS pixels. Returns NaN if the bucket would fall on a
 * non-integer cell offset (corrupt input).
 */
export function bucketTsToX(scale: ChartScale, bucketTs: number): number {
  const offset = (scale.latestBucketTs - bucketTs) / scale.barDurationMs;
  if (!Number.isFinite(offset)) return Number.NaN;
  // Right-anchored: offset 0 -> rightmost cell, offset 1 -> one cell left.
  return (
    scale.barRegion.x +
    scale.barRegion.w -
    (offset + 1) * chartConfig.cellWidth +
    scale.scrollX
  );
}

/**
 * Invert `bucketTsToX`. Useful for cursor → cell mapping (Phase 3.2)
 * and for the scroll clamping math — given an X position inside the
 * bar region, return the bucketTs of the cell containing it.
 */
export function xToBucketTs(scale: ChartScale, px: number): number {
  const rightX =
    scale.barRegion.x + scale.barRegion.w + scale.scrollX;
  const offset = Math.floor((rightX - px) / chartConfig.cellWidth);
  return scale.latestBucketTs - offset * scale.barDurationMs;
}

/**
 * Project a `priceBucket` INDEX to its centre Y coordinate inside the
 * bar grid, in CSS pixels.
 *
 * Higher prices are at lower Y (screen top). `priceMid` is centred
 * vertically in the bar region. Each step of `priceBucket` is exactly
 * one row — `priceBucketSize` is NOT consumed here (see ChartScale
 * docblock for the unit convention).
 */
export function priceToY(scale: ChartScale, priceBucket: number): number {
  const midY = scale.barRegion.y + scale.barRegion.h / 2;
  const rowOffset = priceBucket - scale.priceMid;
  // Subtract because higher price = lower Y.
  return midY - rowOffset * chartConfig.cellHeight;
}

/**
 * Invert `priceToY`. Given a Y coordinate inside the bar region,
 * return the `priceBucket` INDEX of the cell row containing it.
 */
export function yToPriceBucket(scale: ChartScale, py: number): number {
  const midY = scale.barRegion.y + scale.barRegion.h / 2;
  // The cell at priceMid spans midY - cellHeight/2 .. midY + cellHeight/2.
  // Each row is one `priceBucket` step.
  const offset = Math.round((midY - py) / chartConfig.cellHeight);
  return scale.priceMid + offset;
}

/**
 * Compute the scroll clamp range for the given scale + number of
 * available bars to scroll back through. Returns `[0, maxScrollX]` —
 * the renderer keeps `scrollX` inside this range so the user cannot
 * scroll past the oldest data on the left.
 *
 * `historyBars` is the number of bars available to the LEFT of the
 * rightmost visible bar (typically `closedCells.length + 1` for the
 * open bar).
 */
export function scrollClampMax(scale: ChartScale, historyBars: number): number {
  const totalBarsWidth = historyBars * chartConfig.cellWidth;
  const visibleWidth = scale.barRegion.w;
  return Math.max(0, totalBarsWidth - visibleWidth);
}
