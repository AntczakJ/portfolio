/**
 * Canvas font-resolution coverage (Phase 4.1 P0-3).
 *
 * The Canvas2D `ctx.font` shorthand parser CANNOT resolve a CSS custom
 * property — assigning `10px var(--font-mono)` silently falls back to the
 * platform default mono, so the chosen JetBrains Mono never paints and the
 * canvas digits mismatch the DOM tape. The fix routes a RESOLVED family
 * string through every painter palette. These tests assert that whatever a
 * painter writes to `ctx.font` is a concrete family list — never a string
 * containing `var(`.
 *
 * We use a recording context that captures each `font` assignment, drive
 * each text-drawing painter once with a non-empty data set, and assert the
 * captured fonts both (a) contain the resolved family and (b) contain no
 * unresolved CSS custom property.
 */
import { describe, expect, it } from 'vitest';

import { paintBarDeltas, paintCells, type CellPalette } from '../painters/cells';
import { paintAxes, type AxisPalette } from '../painters/axes';
import { paintCvd, type CvdPalette } from '../painters/cvd';
import { parseOklch, type OklchTriple } from '../color';
import {
  computeAxisXRegion,
  computeAxisYRegion,
  computeBarRegion,
  type ChartScale,
  type Viewport,
} from '../scale';
import type { NormalizedCell } from '../cells';
import type { CvdPoint } from '@/lib/stores/stream-store';

const RESOLVED_MONO = "'JetBrains Mono', ui-monospace, monospace";

/** A recording 2D context that captures every `font` assignment. */
function makeRecordingCtx(): {
  ctx: CanvasRenderingContext2D;
  fonts: string[];
} {
  const fonts: string[] = [];
  const noop = (): void => {};
  const target: Record<string, unknown> = {
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    strokeText: noop,
    save: noop,
    restore: noop,
    setTransform: noop,
    scale: noop,
    measureText: () => ({ width: 0 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    globalAlpha: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  let fontValue = '';
  const proxy = new Proxy(target, {
    get: (t, prop) => (prop === 'font' ? fontValue : t[prop as string]),
    set: (t, prop, value: unknown) => {
      if (prop === 'font') {
        fontValue = value as string;
        fonts.push(fontValue);
      } else {
        t[prop as string] = value;
      }
      return true;
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, fonts };
}

const VP: Viewport = { x: 0, y: 0, w: 1000, h: 600 };

function makeScale(): ChartScale {
  return {
    barRegion: computeBarRegion(VP),
    latestBucketTs: 1_780_000_000_000,
    barDurationMs: 60_000,
    cellWidth: 48,
    priceMid: 14_200,
    priceBucketSize: 5,
    scrollX: 0,
  };
}

const ok = (s: string): OklchTriple => parseOklch(s);

const cellPalette: CellPalette = {
  cellBg: ok('oklch(0.19 0.013 250)'),
  cellBgStrong: ok('oklch(0.4 0.04 220)'),
  cellFg: 'oklch(0.94 0.005 250)',
  cellFgSubtle: 'oklch(0.62 0.012 250)',
  cellStroke: 'oklch(0.24 0.012 250)',
  imbalanceBuy: ok('oklch(0.72 0.2 152)'),
  imbalanceSell: ok('oklch(0.68 0.22 28)'),
  imbalanceNeutral: ok('oklch(0.45 0.012 250)'),
  bid: 'oklch(0.74 0.16 155)',
  ask: 'oklch(0.7 0.2 28)',
  deltaUp: 'oklch(0.8 0.18 150)',
  deltaDown: 'oklch(0.72 0.2 25)',
  footBand: 'oklch(0.16 0.012 250)',
  fontMono: RESOLVED_MONO,
};

const axisPalette: AxisPalette = {
  tick: 'oklch(0.38 0.012 250)',
  label: 'oklch(0.7 0.012 250)',
  fontMono: RESOLVED_MONO,
};

const cvdPalette: CvdPalette = {
  up: 'oklch(0.8 0.18 150)',
  down: 'oklch(0.72 0.2 25)',
  neutral: 'oklch(0.45 0.012 250)',
  baseline: 'oklch(0.27 0.012 250)',
  label: 'oklch(0.7 0.012 250)',
  fill: 'oklch(0.82 0.16 195 / 0.1)',
  fontMono: RESOLVED_MONO,
};

const cells: NormalizedCell[] = [
  { bucketTs: 1_780_000_000_000, priceBucket: 14_200, bidVolume: 4, askVolume: 9, trades: 12 },
  { bucketTs: 1_780_000_000_000, priceBucket: 14_201, bidVolume: 7, askVolume: 2, trades: 6 },
];

const series: CvdPoint[] = [
  { bucketTs: 1_780_000_000_000 - 60_000, cvd: -3 },
  { bucketTs: 1_780_000_000_000, cvd: 5 },
];

function assertResolved(fonts: string[]): void {
  expect(fonts.length).toBeGreaterThan(0);
  for (const f of fonts) {
    expect(f).not.toContain('var(');
    expect(f).toContain('JetBrains Mono');
  }
}

describe('canvas font resolution (P0-3)', () => {
  it('paintCells writes a resolved mono family, never a CSS var', () => {
    const { ctx, fonts } = makeRecordingCtx();
    paintCells(ctx, computeBarRegion(VP), makeScale(), cells, 12, cellPalette, 1);
    assertResolved(fonts);
  });

  it('paintBarDeltas writes a resolved mono family', () => {
    const { ctx, fonts } = makeRecordingCtx();
    paintBarDeltas(ctx, computeBarRegion(VP), makeScale(), cells, cellPalette);
    assertResolved(fonts);
  });

  it('paintAxes writes a resolved mono family', () => {
    const { ctx, fonts } = makeRecordingCtx();
    paintAxes(
      ctx,
      computeBarRegion(VP),
      computeAxisXRegion(VP),
      computeAxisYRegion(VP),
      makeScale(),
      axisPalette,
      1,
    );
    assertResolved(fonts);
  });

  it('paintCvd writes a resolved mono family', () => {
    const { ctx, fonts } = makeRecordingCtx();
    paintCvd(
      ctx,
      computeBarRegion(VP),
      makeScale(),
      series,
      cvdPalette,
      1,
      (v) => String(v),
    );
    assertResolved(fonts);
  });
});
