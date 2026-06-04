import { describe, expect, it } from 'vitest';

import {
  appendLivePoint,
  toUplotData,
  type UplotData,
} from './series-adapter';
import type { SeriesResponse } from 'pulse-server';

const MONITOR_ID = '00000000-0000-0000-0000-000000000001';

function raw(
  t: number[],
  value: (number | null)[],
): SeriesResponse {
  return { monitorId: MONITOR_ID, window: '24h', resolution: 'raw', t, value };
}

function hourly(
  t: number[],
  avg: (number | null)[],
  p95: (number | null)[],
): SeriesResponse {
  return { monitorId: MONITOR_ID, window: '30d', resolution: 'hourly', t, avg, p95 };
}

describe('toUplotData', () => {
  it('maps a raw (24h) series to [t, value] with one y-series', () => {
    const shaped = toUplotData(raw([100, 200, 300], [12, 15, null]));
    expect(shaped.resolution).toBe('raw');
    expect(shaped.labels).toEqual(['Response']);
    expect(shaped.data).toHaveLength(2);
    expect(shaped.data[0]).toEqual([100, 200, 300]);
    expect(shaped.data[1]).toEqual([12, 15, null]); // null kept as a gap
  });

  it('maps an hourly (7d/30d) series to [t, avg, p95] with two y-series', () => {
    const shaped = toUplotData(
      hourly([1, 2, 3], [10, 20, null], [30, 40, null]),
    );
    expect(shaped.resolution).toBe('hourly');
    expect(shaped.labels).toEqual(['Average', 'p95']);
    expect(shaped.data).toHaveLength(3);
    expect(shaped.data[0]).toEqual([1, 2, 3]);
    expect(shaped.data[1]).toEqual([10, 20, null]);
    expect(shaped.data[2]).toEqual([30, 40, null]);
  });

  it('preserves null gaps (never coerces a null timing to 0)', () => {
    const shaped = toUplotData(raw([1, 2], [null, null]));
    expect(shaped.data[1]).toEqual([null, null]);
  });

  it('pads a value array shorter than t with null gaps (index-alignment guard)', () => {
    const shaped = toUplotData(raw([1, 2, 3], [10]));
    expect(shaped.data[1]).toEqual([10, null, null]);
  });

  it('truncates a value array longer than t', () => {
    const shaped = toUplotData(raw([1, 2], [10, 20, 30]));
    expect(shaped.data[1]).toEqual([10, 20]);
  });

  it('handles a missing value array on a raw series (empty chart, no throw)', () => {
    const series: SeriesResponse = {
      monitorId: MONITOR_ID,
      window: '24h',
      resolution: 'raw',
      t: [1, 2],
    };
    const shaped = toUplotData(series);
    expect(shaped.data[1]).toEqual([null, null]);
  });

  it('handles missing avg/p95 on an hourly series', () => {
    const series: SeriesResponse = {
      monitorId: MONITOR_ID,
      window: '7d',
      resolution: 'hourly',
      t: [1, 2],
    };
    const shaped = toUplotData(series);
    expect(shaped.data[1]).toEqual([null, null]);
    expect(shaped.data[2]).toEqual([null, null]);
  });

  it('returns empty arrays for an empty series', () => {
    const shaped = toUplotData(raw([], []));
    expect(shaped.data[0]).toEqual([]);
    expect(shaped.data[1]).toEqual([]);
  });
});

describe('appendLivePoint', () => {
  const base: UplotData = [
    [100, 200, 300],
    [10, 20, 30],
  ];

  it('appends a strictly-newer point to both arrays', () => {
    const next = appendLivePoint(base, { tSec: 400, value: 40 });
    expect(next[0]).toEqual([100, 200, 300, 400]);
    expect(next[1]).toEqual([10, 20, 30, 40]);
  });

  it('keeps a null (gap) value when appending a down probe', () => {
    const next = appendLivePoint(base, { tSec: 400, value: null });
    expect(next[0]).toEqual([100, 200, 300, 400]);
    expect(next[1]).toEqual([10, 20, 30, null]);
  });

  it('replaces the tail value when the point matches the last x exactly', () => {
    const next = appendLivePoint(base, { tSec: 300, value: 99 });
    expect(next[0]).toEqual([100, 200, 300]); // no new x
    expect(next[1]).toEqual([10, 20, 99]); // tail value replaced
  });

  it('ignores a point older than the tail (the windowed fetch owns that range)', () => {
    const next = appendLivePoint(base, { tSec: 250, value: 99 });
    expect(next[0]).toEqual([100, 200, 300]);
    expect(next[1]).toEqual([10, 20, 30]);
  });

  it('appends onto an empty dataset', () => {
    const next = appendLivePoint([[], []], { tSec: 100, value: 10 });
    expect(next[0]).toEqual([100]);
    expect(next[1]).toEqual([10]);
  });

  it('trims to the rolling cap, dropping the oldest points', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [1, 2, 3, 4, 5];
    const next = appendLivePoint([xs, ys], { tSec: 6, value: 6 }, 3);
    expect(next[0]).toEqual([4, 5, 6]);
    expect(next[1]).toEqual([4, 5, 6]);
  });

  it('does not mutate the input arrays', () => {
    const xs = [100, 200];
    const ys = [10, 20];
    appendLivePoint([xs, ys], { tSec: 300, value: 30 });
    expect(xs).toEqual([100, 200]);
    expect(ys).toEqual([10, 20]);
  });
});
