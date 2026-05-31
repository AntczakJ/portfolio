import {
  computeImbalance,
  computeIntensity,
  formatCellVolume,
  isLowConfidence,
  type NormalizedCell,
} from '../cells';
import { formatOklch, lerpOklch, type OklchTriple } from '../color';
import {
  bucketTsToX,
  chartConfig,
  priceToY,
  type BarRegion,
  type ChartScale,
} from '../scale';

/**
 * Bundle of parsed OKLCH anchors the painter needs every frame. The
 * engine caches these per theme snapshot (the parse cost is paid once
 * per `data-theme` flip, never per frame).
 */
export interface CellPalette {
  cellBg: OklchTriple;
  cellBgStrong: OklchTriple;
  cellFg: string;
  cellFgSubtle: string;
  cellStroke: string;
  imbalanceBuy: OklchTriple;
  imbalanceSell: OklchTriple;
  imbalanceNeutral: OklchTriple;
}

/**
 * Per-cell painted entry. Computed from the normalized cell once,
 * then drawn under two batched passes:
 *
 *   1. **Fill batch.** Cells with the same final fill color group
 *      into one `ctx.fillRect` series — switching `fillStyle` is the
 *      single most expensive operation on a 2D context. Because each
 *      cell's fill is a unique OKLCH lerp, we can't collapse fills
 *      across imbalances, but we DO collapse text fills which all
 *      land on one of two colors (full or subtle).
 *   2. **Text batch.** Two passes — one for full-fg labels, one for
 *      subtle-fg labels — each sets `fillStyle` once.
 *
 * The pre-compute is what makes batching cheap: one walk of the
 * cells, one fill per cell, then the two text passes.
 */
interface PaintedCell {
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor: string;
  text: string;
  textColor: string;
  textX: number;
  textY: number;
}

/**
 * Render all visible cells (closed + open).
 *
 * `sessionMaxTrades` drives the volume-intensity gradient — track it
 * in the engine across the session lifetime.
 *
 * Imbalance mixing rule (the OKLCH lerp):
 *   - `imbalance > 0` (buy side dominating): lerp from neutral toward
 *     `imbalanceBuy` by `|imbalance|`.
 *   - `imbalance < 0` (sell side dominating): lerp from neutral toward
 *     `imbalanceSell`.
 *   - `imbalance === 0`: stays at neutral.
 *
 * The volume-intensity gradient is applied independently as a SECOND
 * lerp from `cellBg` to `cellBgStrong` keyed on
 * `trades / sessionMaxTrades`. The two gradients are mixed by
 * averaging the L/C/H components — high-intensity cells take their
 * lightness from `cellBg-strong` but their hue from the imbalance
 * gradient. This keeps the strongest cells visually distinct from
 * weak ones AND keeps the bid/ask color signal legible across the
 * intensity range.
 *
 * Cells whose pixel rectangle falls outside the bar region are
 * skipped — basic frustum cull at the cell level. We over-render by
 * one cell on each side to avoid edge-pop on scroll.
 */
export function paintCells(
  ctx: CanvasRenderingContext2D,
  region: BarRegion,
  scale: ChartScale,
  cells: NormalizedCell[],
  sessionMaxTrades: number,
  palette: CellPalette,
  dpr: number,
): void {
  if (cells.length === 0) return;

  // Pre-compute every visible cell's geometry + colors.
  const painted: PaintedCell[] = [];
  for (const cell of cells) {
    const x = bucketTsToX(scale, cell.bucketTs);
    if (!Number.isFinite(x)) continue;
    if (x + chartConfig.cellWidth < region.x) continue;
    if (x > region.x + region.w) continue;

    // priceToY returns the row centre — shift up by half-height for
    // the rectangle's top-left corner.
    const yCentre = priceToY(scale, cell.priceBucket);
    const y = yCentre - chartConfig.cellHeight / 2;
    if (y + chartConfig.cellHeight < region.y) continue;
    if (y > region.y + region.h) continue;

    const imbalance = computeImbalance(cell);
    const intensity = computeIntensity(cell, sessionMaxTrades);
    const fillColor = mixCellFill(palette, imbalance, intensity);

    const text = formatCellVolume(cell);
    const textColor = isLowConfidence(cell)
      ? palette.cellFgSubtle
      : palette.cellFg;
    painted.push({
      x,
      y,
      w: chartConfig.cellWidth,
      h: chartConfig.cellHeight,
      fillColor,
      text,
      textColor,
      // Centre the text within the cell.
      textX: x + chartConfig.cellWidth / 2,
      textY: y + chartConfig.cellHeight / 2,
    });
  }

  if (painted.length === 0) return;

  // Pass 1: fills. Each cell has a unique color in practice — but the
  // OKLCH lerp produces only as many distinct strings as there are
  // distinct (imbalance, intensity) pairs. Sort by fillColor first so
  // adjacent same-color cells batch into one fillStyle assignment.
  painted.sort((a, b) => (a.fillColor < b.fillColor ? -1 : a.fillColor > b.fillColor ? 1 : 0));

  let currentFill = '';
  for (const p of painted) {
    if (p.fillColor !== currentFill) {
      ctx.fillStyle = p.fillColor;
      currentFill = p.fillColor;
    }
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }

  // Pass 2: cell strokes — one fillStyle assignment for the whole
  // batch. We use strokeRect to draw a 1-device-pixel hairline.
  ctx.strokeStyle = palette.cellStroke;
  ctx.lineWidth = 1 / dpr;
  const snap = 0.5 / dpr;
  for (const p of painted) {
    ctx.strokeRect(
      Math.round(p.x) + snap,
      Math.round(p.y) + snap,
      p.w,
      p.h,
    );
  }

  // Pass 3 + 4: text. Skip entirely when cell height is below the
  // legible font size — the readability bar matters more than
  // completeness.
  if (chartConfig.cellHeight < chartConfig.cellFontSize + 2) return;

  ctx.font = `${chartConfig.cellFontSize}px var(--font-mono), ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Full-fg text first.
  ctx.fillStyle = palette.cellFg;
  for (const p of painted) {
    if (p.text === '' || p.textColor !== palette.cellFg) continue;
    ctx.fillText(p.text, p.textX, p.textY);
  }

  // Subtle-fg text second.
  ctx.fillStyle = palette.cellFgSubtle;
  for (const p of painted) {
    if (p.text === '' || p.textColor !== palette.cellFgSubtle) continue;
    ctx.fillText(p.text, p.textX, p.textY);
  }
}

/**
 * Mix the cell fill from two independent OKLCH lerps:
 *   - hue/chroma from the imbalance anchor lerp
 *   - lightness from the intensity lerp
 */
function mixCellFill(
  palette: CellPalette,
  imbalance: number,
  intensity: number,
): string {
  // Imbalance gradient: pick the right anchor and lerp away from
  // neutral by |imbalance|.
  const sign = imbalance >= 0 ? 1 : -1;
  const anchor =
    sign === 1 ? palette.imbalanceBuy : palette.imbalanceSell;
  const hueColor = lerpOklch(
    palette.imbalanceNeutral,
    anchor,
    Math.abs(imbalance),
  );

  // Intensity gradient: lerp cellBg -> cellBgStrong by intensity.
  const intensityColor = lerpOklch(
    palette.cellBg,
    palette.cellBgStrong,
    intensity,
  );

  // Mix: take L from intensity, C+H from imbalance, alpha defaults to opaque.
  return formatOklch({
    L: intensityColor.L,
    C: hueColor.C,
    H: hueColor.H,
    alpha: undefined,
  });
}
