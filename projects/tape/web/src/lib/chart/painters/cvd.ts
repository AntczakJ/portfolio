/**
 * CVD (Cumulative Volume Delta) line sub-pane painter (Task 3.2c).
 *
 * Draws a single running-CVD line beneath the footprint chart, sharing
 * the footprint's X-axis. The pane is a SEPARATE canvas but is painted
 * inside the SAME engine rAF pass with the SAME `ChartScale`, so a
 * `bucketTs` lands at the identical X pixel in both panes — the two are
 * column-aligned without a second time model.
 *
 * What it renders, in paint order:
 *   1. A baseline ZERO line across the pane width — the reference the
 *      line is read against. Always present (not colour-dependent), so
 *      a CVD reading is legible without relying on the line colour
 *      alone (WCAG: never colour as the sole channel).
 *   2. The CVD polyline, colour-coded by the SLOPE of its most recent
 *      segment (rising = buy-side green, falling = sell-side red, flat =
 *      neutral). The colour is a redundant cue — the line's vertical
 *      direction and the numeric label below carry the same information.
 *   3. A numeric current-value label (`CVD +123.4`) anchored top-left,
 *      and a `0` tick on the baseline — the always-present non-colour
 *      readout of the current cumulative value.
 *
 * Y scaling:
 *   - The pane auto-scales its Y range to the visible series extent
 *     (min..max of the rendered points), padded so the line never
 *     clips the pane edges, and always includes zero so the baseline is
 *     on-screen. A flat-zero series renders the baseline centred.
 *
 * Frame budget: one polyline stroke + one baseline stroke + two text
 * fills. All coordinates are CSS pixels — the engine has already
 * applied `ctx.scale(dpr, dpr)`; painters never re-multiply. Hairlines
 * use the `1 / dpr` width + `0.5 / dpr` snap convention shared with the
 * other painters.
 */
import {
  bucketTsToX,
  cellWidthOf,
  chartConfig,
  type BarRegion,
  type ChartScale,
} from '../scale';
import type { CvdPoint } from '@/lib/stores/stream-store';

export interface CvdPalette {
  /** Rising-slope line colour (net buying). */
  up: string;
  /** Falling-slope line colour (net selling). */
  down: string;
  /** Flat / neutral line colour. */
  neutral: string;
  /** Baseline zero line. */
  baseline: string;
  /** Numeric label + zero tick text. */
  label: string;
  /** Low-alpha area fill between the line and the zero baseline (P1-4). */
  fill: string;
  /** Resolved monospace family for `ctx.font` (P0-3). */
  fontMono: string;
}

/** Vertical inset inside the pane so the line never touches the edges. */
const PANE_PADDING_Y = 10;

/** Label inset from the pane's top-left corner. */
const LABEL_INSET_X = 8;
const LABEL_INSET_Y = 6;

/**
 * Slope direction of the series' most recent segment. Exported as a
 * pure helper so it can be unit-tested and reused by any chrome that
 * wants the same up/down/flat classification (e.g. the SR readout).
 *
 * Returns +1 (rising), -1 (falling), or 0 (flat / fewer than two
 * points). The comparison is on the last two points' running CVD.
 */
export function cvdSlopeDirection(series: readonly CvdPoint[]): -1 | 0 | 1 {
  if (series.length < 2) return 0;
  const prev = series[series.length - 2];
  const last = series[series.length - 1];
  if (prev === undefined || last === undefined) return 0;
  if (last.cvd > prev.cvd) return 1;
  if (last.cvd < prev.cvd) return -1;
  return 0;
}

/**
 * Compute the [min, max] CVD range to scale the pane against, always
 * including zero so the baseline is visible. Exported for unit tests.
 */
export function cvdValueRange(series: readonly CvdPoint[]): {
  min: number;
  max: number;
} {
  let min = 0;
  let max = 0;
  for (const p of series) {
    if (p.cvd < min) min = p.cvd;
    if (p.cvd > max) max = p.cvd;
  }
  // Guard a degenerate zero-span range so the baseline sits centred and
  // we never divide by zero in the Y map.
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

/**
 * Map a CVD value to a Y pixel inside the pane region. Higher CVD =
 * higher on screen (lower Y), matching the footprint's price axis
 * convention. Exported for unit tests.
 */
export function cvdValueToY(
  value: number,
  range: { min: number; max: number },
  region: BarRegion,
): number {
  const top = region.y + PANE_PADDING_Y;
  const bottom = region.y + region.h - PANE_PADDING_Y;
  const span = range.max - range.min;
  const t = (value - range.min) / span; // 0 at min, 1 at max
  return bottom - t * (bottom - top);
}

export function paintCvd(
  ctx: CanvasRenderingContext2D,
  region: BarRegion,
  scale: ChartScale,
  series: readonly CvdPoint[],
  palette: CvdPalette,
  dpr: number,
  formatValue: (v: number) => string,
): void {
  if (region.w <= 0 || region.h <= 0) return;

  const snap = 0.5 / dpr;
  const range = cvdValueRange(series);
  const cw = cellWidthOf(scale);

  // ---- 1. Baseline zero line. Always drawn.
  const zeroY = cvdValueToY(0, range, region);
  ctx.strokeStyle = palette.baseline;
  ctx.lineWidth = 1 / dpr;
  ctx.beginPath();
  ctx.moveTo(region.x, Math.round(zeroY) + snap);
  ctx.lineTo(region.x + region.w, Math.round(zeroY) + snap);
  ctx.stroke();

  // Build the polyline point list once — reused by the area fill and
  // the stroke so both trace the identical path.
  const pts: { x: number; y: number }[] = [];
  for (const point of series) {
    // Each bar's CVD point anchors at the bar's CELL CENTRE X so the
    // line tracks the column centres of the footprint above.
    const x = bucketTsToX(scale, point.bucketTs) + cw / 2;
    if (!Number.isFinite(x)) continue;
    pts.push({ x, y: cvdValueToY(point.cvd, range, region) });
  }

  // ---- 2a. Area fill between the line and the zero baseline (P1-4) —
  // low alpha so the swing magnitude reads as a filled silhouette, not
  // just a hairline. Drawn UNDER the stroke.
  if (pts.length >= 2) {
    ctx.fillStyle = palette.fill;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, zeroY);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1]!.x, zeroY);
    ctx.closePath();
    ctx.fill();
  }

  // ---- 2b. CVD polyline. Only when we have at least two points to join.
  if (pts.length >= 2) {
    const dir = cvdSlopeDirection(series);
    ctx.strokeStyle =
      dir > 0 ? palette.up : dir < 0 ? palette.down : palette.neutral;
    ctx.lineWidth = Math.max(1, 1.5 / dpr) * dpr; // ~1.5 CSS px line
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
  }

  // ---- 3. Numeric readout. Current cumulative value, top-left.
  const lastPoint = series[series.length - 1];
  const current = lastPoint?.cvd ?? 0;
  ctx.fillStyle = palette.label;
  ctx.font = `${String(chartConfig.axisFontSize)}px ${palette.fontMono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `CVD ${formatValue(current)}`,
    region.x + LABEL_INSET_X,
    region.y + LABEL_INSET_Y,
  );

  // Zero tick label on the baseline — the non-colour anchor for reading
  // whether the line sits above or below zero.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('0', region.x + region.w - 4, Math.round(zeroY));

  // ---- 4. Min / max Y labels at the right edge (P1-4) so the swing
  // magnitude is readable. Only when the series has a real (non-
  // degenerate) extent — otherwise the synthetic ±1 guard range would
  // print misleading bounds.
  const hasExtent = range.max > 0 || range.min < 0;
  if (hasExtent) {
    ctx.fillStyle = palette.label;
    if (range.max > 0) {
      ctx.textBaseline = 'top';
      ctx.fillText(
        formatValue(range.max),
        region.x + region.w - 4,
        cvdValueToY(range.max, range, region) + 1,
      );
    }
    if (range.min < 0) {
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        formatValue(range.min),
        region.x + region.w - 4,
        cvdValueToY(range.min, range, region) - 1,
      );
    }
  }
}
