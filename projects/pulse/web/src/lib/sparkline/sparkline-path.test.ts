import { describe, expect, it } from 'vitest';

import { buildSparkline } from './sparkline-path';
import type { SparklinePoint } from '@/lib/store/live-store';

const DIMS = { width: 100, height: 40 } as const;

function point(value: number | null, status: SparklinePoint['status'] = 'up'): SparklinePoint {
  return { value, status, at: 0 };
}

describe('buildSparkline', () => {
  it('reports no data for an empty buffer', () => {
    const geo = buildSparkline([], DIMS);
    expect(geo.hasData).toBe(false);
    expect(geo.line).toBe('');
    expect(geo.lastPoint).toBeNull();
  });

  it('reports no data when every point is a null gap', () => {
    const geo = buildSparkline([point(null), point(null)], DIMS);
    expect(geo.hasData).toBe(false);
  });

  it('draws a single point as a centred horizontal segment', () => {
    const geo = buildSparkline([point(100)], DIMS);
    expect(geo.hasData).toBe(true);
    // One point -> the line starts at x=0 and the leading dot is at x=0.
    expect(geo.line.startsWith('M0')).toBe(true);
    expect(geo.lastPoint?.x).toBe(0);
  });

  it('maps the newest value to the trailing x coordinate', () => {
    const geo = buildSparkline([point(100), point(200), point(300)], DIMS);
    // 3 points over width 100 -> step 50, last index 2 -> x = 100.
    expect(geo.lastPoint?.x).toBe(100);
    expect(geo.lastStatus).toBe('up');
  });

  it('puts a higher response time higher on the chart (smaller y)', () => {
    const geo = buildSparkline([point(100), point(900)], DIMS);
    // The peak (900) must sit above the trough (100): its y is smaller.
    // Re-derive: the last point is 900, so lastPoint.y should be near the top.
    expect(geo.lastPoint).not.toBeNull();
    const lowGeo = buildSparkline([point(900), point(100)], DIMS);
    // Now the last point is 100 (the trough) -> a LARGER y than the peak case.
    expect(lowGeo.lastPoint?.y).toBeGreaterThan(geo.lastPoint?.y ?? 0);
  });

  it('breaks the line at a null gap (does not dive to zero)', () => {
    const geo = buildSparkline([point(100), point(null), point(200)], DIMS);
    // Two segments => two `M` move commands in the path.
    const moveCount = (geo.line.match(/M/g) ?? []).length;
    expect(moveCount).toBe(2);
    expect(geo.hasData).toBe(true);
  });

  it('colours the sparkline by the latest point status', () => {
    const geo = buildSparkline([point(100, 'up'), point(200, 'down')], DIMS);
    expect(geo.lastStatus).toBe('down');
  });

  it('produces a closed area path under the line', () => {
    const geo = buildSparkline([point(100), point(200)], DIMS);
    expect(geo.area.endsWith('Z')).toBe(true);
  });
});
