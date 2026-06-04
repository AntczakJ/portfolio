import { describe, expect, it } from 'vitest';

import {
  bucketTsToX,
  cellWidthOf,
  chartConfig,
  computeBarRegion,
  FIT_CELL_MAX_WIDTH,
  fitCellWidth,
  priceToY,
  scrollClampMax,
  xToBucketTs,
  yToPriceBucket,
  type ChartScale,
  type Viewport,
} from '../scale';

const VP: Viewport = { x: 0, y: 0, w: 800, h: 600 };
const BAR_REGION = computeBarRegion(VP);

function makeScale(overrides: Partial<ChartScale> = {}): ChartScale {
  return {
    barRegion: BAR_REGION,
    latestBucketTs: 1_780_000_000_000,
    barDurationMs: 60_000,
    // priceMid is in `priceBucket` INDEX units. 71_000 USD / $5 = 14_200.
    priceMid: 14_200,
    priceBucketSize: 5,
    scrollX: 0,
    ...overrides,
  };
}

describe('bucketTsToX', () => {
  it('places latestBucketTs at the right edge minus one cell width', () => {
    const scale = makeScale();
    const x = bucketTsToX(scale, scale.latestBucketTs);
    expect(x).toBeCloseTo(
      BAR_REGION.x + BAR_REGION.w - chartConfig.cellWidth,
    );
  });

  it('shifts earlier buckets left by N cell widths', () => {
    const scale = makeScale();
    const x0 = bucketTsToX(scale, scale.latestBucketTs);
    const x1 = bucketTsToX(scale, scale.latestBucketTs - 60_000);
    expect(x1).toBeCloseTo(x0 - chartConfig.cellWidth);
  });

  it('shifts the whole grid by scrollX', () => {
    const a = bucketTsToX(makeScale(), 1_780_000_000_000);
    const b = bucketTsToX(makeScale({ scrollX: 50 }), 1_780_000_000_000);
    expect(b - a).toBeCloseTo(50);
  });
});

describe('xToBucketTs round-trip', () => {
  it('maps an X back to the bucket containing it', () => {
    const scale = makeScale();
    const target = scale.latestBucketTs - 3 * 60_000;
    const x = bucketTsToX(scale, target);
    const back = xToBucketTs(scale, x + chartConfig.cellWidth / 2);
    expect(back).toBe(target);
  });
});

describe('priceToY', () => {
  it('places priceMid at the bar region centre', () => {
    const scale = makeScale();
    const y = priceToY(scale, scale.priceMid);
    expect(y).toBeCloseTo(BAR_REGION.y + BAR_REGION.h / 2);
  });

  it('places higher prices (higher INDEX) at lower Y', () => {
    const scale = makeScale();
    const yMid = priceToY(scale, scale.priceMid);
    // +1 INDEX step = one row up regardless of priceBucketSize.
    const yHigh = priceToY(scale, scale.priceMid + 1);
    expect(yHigh).toBeLessThan(yMid);
  });

  it('moves exactly one cellHeight per INDEX step', () => {
    const scale = makeScale();
    const yMid = priceToY(scale, scale.priceMid);
    const yNext = priceToY(scale, scale.priceMid + 1);
    expect(yMid - yNext).toBeCloseTo(chartConfig.cellHeight);
  });
});

describe('yToPriceBucket round-trip', () => {
  it('maps Y back to its row price bucket INDEX', () => {
    const scale = makeScale();
    const target = scale.priceMid - 5; // 5 rows below centre
    const y = priceToY(scale, target);
    const back = yToPriceBucket(scale, y);
    expect(back).toBe(target);
  });
});

describe('scrollClampMax', () => {
  it('returns 0 when history fits in the viewport', () => {
    const scale = makeScale();
    expect(scrollClampMax(scale, 5)).toBe(0);
  });

  it('returns the overflow width when history exceeds the viewport', () => {
    const scale = makeScale();
    const huge = 10_000;
    const max = scrollClampMax(scale, huge);
    expect(max).toBe(huge * chartConfig.cellWidth - BAR_REGION.w);
    expect(max).toBeGreaterThan(0);
  });
});

describe('cellWidthOf (P0-1 fit-to-data)', () => {
  it('falls back to the static default when scale carries no cellWidth', () => {
    expect(cellWidthOf(makeScale())).toBe(chartConfig.cellWidth);
  });

  it('honours a fit-to-data cellWidth when present', () => {
    expect(cellWidthOf(makeScale({ cellWidth: 42 }))).toBe(42);
  });

  it('floors a degenerate (<=0) cellWidth back to the default', () => {
    expect(cellWidthOf(makeScale({ cellWidth: 0 }))).toBe(chartConfig.cellWidth);
  });

  it('makes bucketTsToX honour the fit-to-data width', () => {
    const wide = makeScale({ cellWidth: 60 });
    const x0 = bucketTsToX(wide, wide.latestBucketTs);
    const x1 = bucketTsToX(wide, wide.latestBucketTs - 60_000);
    expect(x0 - x1).toBeCloseTo(60);
  });
});

describe('fitCellWidth (P0-1)', () => {
  it('spreads a small bar count to fill the region (up to the cap)', () => {
    // 5 bars in a 1000 px region would want 200 px each — clamped to cap.
    expect(fitCellWidth(1000, 5)).toBe(FIT_CELL_MAX_WIDTH);
  });

  it('divides the region evenly when the ideal width is in-band', () => {
    // 30 bars in 1080 px => 36 px each (between default 24 and cap 96).
    expect(fitCellWidth(1080, 30)).toBeCloseTo(36);
  });

  it('pins to the default width once bars no longer fit', () => {
    // 100 bars in 1000 px => 10 px ideal, below the 24 px floor.
    expect(fitCellWidth(1000, 100)).toBe(chartConfig.cellWidth);
  });

  it('never returns a non-finite or zero width for degenerate input', () => {
    expect(fitCellWidth(0, 30)).toBe(chartConfig.cellWidth);
    expect(fitCellWidth(1000, 0)).toBe(chartConfig.cellWidth);
  });

  it('30 bars FILL a typical pane — the wow-moment first paint', () => {
    // PLAN: first paint = the last ~30 minutes. The fitted columns must
    // span essentially the whole region (no dead left void).
    const regionW = 1100;
    const cw = fitCellWidth(regionW, 30);
    expect(cw * 30).toBeGreaterThanOrEqual(regionW * 0.95);
  });
});
