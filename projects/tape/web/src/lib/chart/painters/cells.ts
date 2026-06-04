import {
  computeImbalance,
  computeIntensity,
  formatBarDelta,
  formatCellVolume,
  formatSideVolume,
  isLowConfidence,
  type NormalizedCell,
} from '../cells';
import { formatOklch, lerpOklch, type OklchTriple } from '../color';
import {
  bucketTsToX,
  cellWidthOf,
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
  /** Bid-side histogram fill (sell-aggressed volume). */
  bid: string;
  /** Ask-side histogram fill (buy-aggressed volume). */
  ask: string;
  /** Delta-positive (net buying) foot label colour. */
  deltaUp: string;
  /** Delta-negative (net selling) foot label colour. */
  deltaDown: string;
  /** Solid backdrop for the per-bar delta foot band. */
  footBand: string;
  /**
   * Concrete monospace family string for `ctx.font` (P0-3). The Canvas2D
   * font shorthand cannot resolve `var(--font-mono)`; this is the
   * resolved literal read from the theme bridge.
   */
  fontMono: string;
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
  /** Background fill (intensity x imbalance tint) behind the split. */
  fillColor: string;
  /** Bid (left) histogram width in px, proportional to bid share. */
  bidBarW: number;
  /** Ask (right) histogram width in px, proportional to ask share. */
  askBarW: number;
  /** Bid volume label (left column). */
  bidText: string;
  /** Ask volume label (right column). */
  askText: string;
  textColor: string;
  /** X centre of the bid (left) column. */
  bidTextX: number;
  /** X centre of the ask (right) column. */
  askTextX: number;
  textY: number;
}

/**
 * Below this cell width we cannot fit the canonical two-number bid|ask
 * split legibly, so we fall back to a single total-volume label. The
 * fit-to-data sizing in the engine keeps the live window at or above
 * this width whenever the data permits, so the split is the norm and
 * the single-number fallback is the degenerate (very dense) case only.
 */
export const SPLIT_CELL_MIN_WIDTH = 40;

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

  const cellW = cellWidthOf(scale);
  const cellH = chartConfig.cellHeight;
  // Inner gutter so the histogram bars + numbers do not touch the cell
  // border. The split is symmetric around the cell centre.
  const innerPad = 3;
  const halfBar = Math.max(0, cellW / 2 - innerPad);
  // Whether the cell is wide enough for the canonical two-number split.
  const split = cellW >= SPLIT_CELL_MIN_WIDTH;

  // Pre-compute every visible cell's geometry + colors.
  const painted: PaintedCell[] = [];
  for (const cell of cells) {
    const x = bucketTsToX(scale, cell.bucketTs);
    if (!Number.isFinite(x)) continue;
    if (x + cellW < region.x) continue;
    if (x > region.x + region.w) continue;

    // priceToY returns the row centre — shift up by half-height for
    // the rectangle's top-left corner.
    const yCentre = priceToY(scale, cell.priceBucket);
    const y = yCentre - cellH / 2;
    if (y + cellH < region.y) continue;
    if (y > region.y + region.h) continue;

    const imbalance = computeImbalance(cell);
    const intensity = computeIntensity(cell, sessionMaxTrades);
    const fillColor = mixCellFill(palette, imbalance, intensity);

    // Split histogram: each side's bar length is proportional to its
    // share of the cell total — the divider position IS the imbalance,
    // a non-colour channel (P1-3). Bid grows LEFT of centre, ask grows
    // RIGHT.
    const total = cell.bidVolume + cell.askVolume;
    const bidShare = total > 0 ? cell.bidVolume / total : 0;
    const askShare = total > 0 ? cell.askVolume / total : 0;

    const textColor = isLowConfidence(cell)
      ? palette.cellFgSubtle
      : palette.cellFg;

    painted.push({
      x,
      y,
      w: cellW,
      h: cellH,
      fillColor,
      bidBarW: bidShare * halfBar,
      askBarW: askShare * halfBar,
      bidText: split ? formatSideVolume(cell.bidVolume) : formatCellVolume(cell),
      askText: split ? formatSideVolume(cell.askVolume) : '',
      textColor,
      bidTextX: x + cellW / 2 - innerPad,
      askTextX: x + cellW / 2 + innerPad,
      textY: y + cellH / 2,
    });
  }

  if (painted.length === 0) return;

  const snap = 0.5 / dpr;

  // Pass 1: backdrop fills. Sort by fillColor so adjacent same-colour
  // cells batch into one fillStyle assignment (the dominant 2D cost).
  painted.sort((a, b) =>
    a.fillColor < b.fillColor ? -1 : a.fillColor > b.fillColor ? 1 : 0,
  );
  let currentFill = '';
  for (const p of painted) {
    if (p.fillColor !== currentFill) {
      ctx.fillStyle = p.fillColor;
      currentFill = p.fillColor;
    }
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }

  // Pass 2: split histogram bars. Two batched passes (bid then ask) so
  // `fillStyle` is assigned exactly twice. Bars are drawn at reduced
  // alpha so the volume number on top stays legible.
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = palette.bid;
  for (const p of painted) {
    if (p.bidBarW <= 0) continue;
    const centre = p.x + p.w / 2;
    ctx.fillRect(centre - p.bidBarW, p.y + 1, p.bidBarW, p.h - 2);
  }
  ctx.fillStyle = palette.ask;
  for (const p of painted) {
    if (p.askBarW <= 0) continue;
    const centre = p.x + p.w / 2;
    ctx.fillRect(centre, p.y + 1, p.askBarW, p.h - 2);
  }
  ctx.globalAlpha = 1;

  // Pass 3: cell strokes — one strokeStyle assignment for the batch.
  ctx.strokeStyle = palette.cellStroke;
  ctx.lineWidth = 1 / dpr;
  for (const p of painted) {
    ctx.strokeRect(Math.round(p.x) + snap, Math.round(p.y) + snap, p.w, p.h);
  }

  // Pass 4: centre divider hairline — the bid|ask separator. Drawn in
  // the ask colour at low alpha so the eye reads the split axis.
  ctx.strokeStyle = palette.cellStroke;
  ctx.beginPath();
  for (const p of painted) {
    const cx = Math.round(p.x + p.w / 2) + snap;
    ctx.moveTo(cx, p.y + 1);
    ctx.lineTo(cx, p.y + p.h - 1);
  }
  ctx.stroke();

  // Pass 5: text. Skip when the cell is too short for a legible glyph.
  if (cellH < chartConfig.cellFontSize + 2) {
    return;
  }

  ctx.font = `${chartConfig.cellFontSize}px ${palette.fontMono}`;
  ctx.textBaseline = 'middle';

  if (split) {
    // Two columns: bid right-aligned to the left of the divider, ask
    // left-aligned to the right of the divider.
    ctx.fillStyle = palette.bid;
    ctx.textAlign = 'right';
    for (const p of painted) {
      if (p.bidText === '') continue;
      ctx.fillText(p.bidText, p.bidTextX, p.textY);
    }
    ctx.fillStyle = palette.ask;
    ctx.textAlign = 'left';
    for (const p of painted) {
      if (p.askText === '') continue;
      ctx.fillText(p.askText, p.askTextX, p.textY);
    }
  } else {
    // Narrow fallback: single centred total-volume number.
    ctx.textAlign = 'center';
    ctx.fillStyle = palette.cellFg;
    for (const p of painted) {
      if (p.bidText === '' || p.textColor !== palette.cellFg) continue;
      ctx.fillText(p.bidText, p.x + p.w / 2, p.textY);
    }
    ctx.fillStyle = palette.cellFgSubtle;
    for (const p of painted) {
      if (p.bidText === '' || p.textColor !== palette.cellFgSubtle) continue;
      ctx.fillText(p.bidText, p.x + p.w / 2, p.textY);
    }
  }
}

/**
 * Paint the per-bar delta number at the FOOT of each bar column (the
 * defining footprint summary: net ask − bid across the bar). Drawn as a
 * separate pass from `paintCells` because it is one label per BAR, not
 * per cell — the engine groups the visible cells by bucketTs and calls
 * this once. The label is colour-coded (green up / red down) AND signed
 * (`+`/`-`), so dominance reads without colour (P1-3).
 */
export function paintBarDeltas(
  ctx: CanvasRenderingContext2D,
  region: BarRegion,
  scale: ChartScale,
  cells: NormalizedCell[],
  palette: CellPalette,
): void {
  if (cells.length === 0) return;

  const cellW = cellWidthOf(scale);

  // Group cells by bar (bucketTs) and sum the delta.
  const byBar = new Map<number, number>();
  for (const c of cells) {
    byBar.set(c.bucketTs, (byBar.get(c.bucketTs) ?? 0) + (c.askVolume - c.bidVolume));
  }

  // Foot band: a strip across the bottom of the bar region that hosts the
  // per-bar delta labels. A solid backdrop keeps the number legible over
  // any cells that reach the bottom row.
  const bandH = chartConfig.cellFontSize + 4;
  const bandY = region.y + region.h - bandH;
  ctx.fillStyle = palette.footBand;
  ctx.fillRect(region.x, bandY, region.w, bandH);

  const footY = bandY + bandH / 2;
  ctx.font = `600 ${chartConfig.cellFontSize}px ${palette.fontMono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [bucketTs, delta] of byBar) {
    const x = bucketTsToX(scale, bucketTs);
    if (!Number.isFinite(x)) continue;
    if (x + cellW < region.x || x > region.x + region.w) continue;
    ctx.fillStyle =
      delta > 0 ? palette.deltaUp : delta < 0 ? palette.deltaDown : palette.cellFgSubtle;
    ctx.fillText(formatBarDelta(delta), x + cellW / 2, footY);
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
