import {
  cellWidthOf,
  chartConfig,
  type BarRegion,
  type ChartScale,
} from '../scale';

/**
 * Hairline horizontal + vertical grid inside the bar region.
 *
 * Horizontal lines snap to every Nth price row so the grid stays
 * readable as the price range stretches; vertical lines snap to every
 * Mth bar (5-minute boundaries by default for 1-min bars). Both pass
 * through a half-pixel offset so the 1px stroke renders crisp under
 * `ctx.scale(dpr, dpr)`.
 */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  region: BarRegion,
  scale: ChartScale,
  gridColor: string,
  dpr: number,
): void {
  ctx.strokeStyle = gridColor;
  // Hairline at any DPR: 1 device pixel converted back to CSS pixels.
  ctx.lineWidth = 1 / dpr;

  // Half-pixel snap: align to the device pixel grid so a 1 px stroke
  // does not bleed across two physical pixel rows.
  const snap = 0.5 / dpr;

  ctx.beginPath();

  // Horizontal lines: every priceTickStride rows, walking outward
  // from the centre.
  const stride = priceRowStride();
  const centerY = region.y + region.h / 2;
  // Walk up from centre.
  for (
    let y = centerY;
    y >= region.y;
    y -= chartConfig.cellHeight * stride
  ) {
    const py = Math.round(y) + snap;
    ctx.moveTo(region.x, py);
    ctx.lineTo(region.x + region.w, py);
  }
  // Walk down from centre.
  for (
    let y = centerY + chartConfig.cellHeight * stride;
    y <= region.y + region.h;
    y += chartConfig.cellHeight * stride
  ) {
    const py = Math.round(y) + snap;
    ctx.moveTo(region.x, py);
    ctx.lineTo(region.x + region.w, py);
  }

  // Vertical lines: every barTickStride bars. We walk from the right
  // edge backward because the chart is right-anchored.
  const cw = cellWidthOf(scale);
  const barStride = barTickStride();
  const totalBars = Math.ceil(region.w / cw) + 2;
  const rightX = region.x + region.w + scale.scrollX;
  for (let i = 0; i < totalBars; i++) {
    if (i % barStride !== 0) continue;
    const x = rightX - i * cw;
    if (x < region.x || x > region.x + region.w) continue;
    const px = Math.round(x) + snap;
    ctx.moveTo(px, region.y);
    ctx.lineTo(px, region.y + region.h);
  }

  ctx.stroke();
}

/**
 * How many price rows to skip between gridlines. Picks the next power
 * of two that keeps gridlines at least ~48 px apart, so the grid
 * remains readable as the viewport shrinks.
 */
function priceRowStride(): number {
  const minPxBetweenLines = 48;
  const rowsBetween = Math.max(
    1,
    Math.ceil(minPxBetweenLines / chartConfig.cellHeight),
  );
  return rowsBetween;
}

/**
 * Bars between vertical gridlines. v1 uses 5-minute strides for 1-min
 * bars — matches the X-axis label cadence in `paintAxes`. If a future
 * task swaps to 5-min bars, this becomes 1 and the axis labels follow.
 */
function barTickStride(): number {
  return 5;
}
