import { describe, expect, it } from 'vitest';

import {
  mergeBreakdowns,
  observedSeconds,
  uptimeFromRawResults,
  uptimeFromRollups,
  uptimePercentFromBreakdown,
  type RawResultPoint,
} from './uptime-math';

/**
 * Uptime-math invariants (ADR-004). These tests ENCODE the ADR rules — they are
 * the regression guard for the wow-moment-bearing uptime figure:
 *   - degraded counts as 50%,
 *   - unknown gaps (> 2*interval) are excluded from numerator AND denominator,
 *   - a result's coverage is capped at the monitor interval,
 *   - the raw (24h) path and the rollup (7d/30d) path agree on the same math.
 */

const SEC = 1000;
const MIN = 60 * SEC;

describe('uptimeFromRawResults — coverage + the percentage rules', () => {
  it('all up over a perfectly-spaced window => 100% uptime, no unknown', () => {
    const interval = 60; // seconds
    const start = 0;
    const end = 10 * interval * SEC; // 10 intervals
    // 10 results, exactly one interval apart, all up.
    const results: RawResultPoint[] = Array.from({ length: 10 }, (_, i) => ({
      checkedAtMs: i * interval * SEC,
      status: 'up' as const,
    }));

    const b = uptimeFromRawResults(results, start, end, interval);
    expect(uptimePercentFromBreakdown(b)).toBe(100);
    expect(b.degradedSeconds).toBe(0);
    expect(b.downSeconds).toBe(0);
    // 10 results each cover one interval => 600s observed.
    expect(observedSeconds(b)).toBe(10 * interval);
  });

  it('degraded counts as 50% against uptime (the DEGRADED_UPTIME_WEIGHT rule)', () => {
    const interval = 60;
    const start = 0;
    const end = 2 * interval * SEC;
    // One up, one degraded, perfectly spaced.
    const results: RawResultPoint[] = [
      { checkedAtMs: 0, status: 'up' },
      { checkedAtMs: interval * SEC, status: 'degraded' },
    ];
    const b = uptimeFromRawResults(results, start, end, interval);
    // up=60s, degraded=60s, down=0. pct = (60 + 0.5*60) / 120 * 100 = 75.
    expect(b.upSeconds).toBe(interval);
    expect(b.degradedSeconds).toBe(interval);
    expect(uptimePercentFromBreakdown(b)).toBe(75);
  });

  it('down counts fully against uptime', () => {
    const interval = 60;
    const start = 0;
    const end = 4 * interval * SEC;
    const results: RawResultPoint[] = [
      { checkedAtMs: 0, status: 'up' },
      { checkedAtMs: interval * SEC, status: 'up' },
      { checkedAtMs: 2 * interval * SEC, status: 'up' },
      { checkedAtMs: 3 * interval * SEC, status: 'down' },
    ];
    const b = uptimeFromRawResults(results, start, end, interval);
    // 3 up (180s) + 1 down (60s) => pct = 180/240 * 100 = 75.
    expect(b.downSeconds).toBe(interval);
    expect(uptimePercentFromBreakdown(b)).toBe(75);
  });

  it('a gap longer than 2*interval is unknown and excluded from BOTH numerator and denominator', () => {
    const interval = 60;
    const start = 0;
    // Two up results, then a long gap (worker down), then one up result.
    // Gap between result 2 and 3 is 10 intervals (>> 2*interval).
    const end = 13 * interval * SEC;
    const results: RawResultPoint[] = [
      { checkedAtMs: 0, status: 'up' },
      { checkedAtMs: interval * SEC, status: 'up' },
      // long gap here
      { checkedAtMs: 12 * interval * SEC, status: 'up' },
    ];
    const b = uptimeFromRawResults(results, start, end, interval);
    // Each up result covers exactly one interval (capped): 3 * 60 = 180s observed.
    expect(observedSeconds(b)).toBe(3 * interval);
    // The ~10-interval gap (minus the one interval the 2nd result covers) is unknown.
    expect(b.unknownSeconds).toBeGreaterThan(8 * interval);
    // Uptime is still 100% — the unknown gap does NOT read as an outage.
    expect(uptimePercentFromBreakdown(b)).toBe(100);
  });

  it("a result's coverage is CAPPED at the interval (a long final span does not inflate it)", () => {
    const interval = 60;
    const start = 0;
    const end = 100 * interval * SEC; // huge window, one result
    const results: RawResultPoint[] = [{ checkedAtMs: 0, status: 'down' }];
    const b = uptimeFromRawResults(results, start, end, interval);
    // The single down result covers at most one interval (60s), not the whole window.
    expect(b.downSeconds).toBe(interval);
    expect(observedSeconds(b)).toBe(interval);
    // The rest of the window is unknown (no data).
    expect(b.unknownSeconds).toBeGreaterThan(90 * interval);
  });

  it('leading time before the first result is unknown (partial window for a young monitor)', () => {
    const interval = 60;
    // Window is 10 intervals, but the first result is at 5 intervals in.
    const start = 0;
    const end = 10 * interval * SEC;
    const results: RawResultPoint[] = [
      { checkedAtMs: 5 * interval * SEC, status: 'up' },
      { checkedAtMs: 6 * interval * SEC, status: 'up' },
    ];
    const b = uptimeFromRawResults(results, start, end, interval);
    // The first 5 intervals (no data) are unknown.
    expect(b.unknownSeconds).toBeGreaterThanOrEqual(5 * interval);
    // Only the observed time counts: 2 up results => 120s, 100% uptime.
    expect(observedSeconds(b)).toBe(2 * interval);
    expect(uptimePercentFromBreakdown(b)).toBe(100);
  });

  it('an empty window yields null uptime (no data) with the whole window unknown', () => {
    const b = uptimeFromRawResults([], 0, 10 * MIN, 60);
    expect(uptimePercentFromBreakdown(b)).toBeNull();
    expect(observedSeconds(b)).toBe(0);
    expect(b.unknownSeconds).toBe(10 * 60);
  });
});

describe('uptimeFromRollups — the 7d/30d path', () => {
  it('counts scale by the interval and degraded is 50%', () => {
    const interval = 60;
    // 100 up, 10 degraded, 5 down across the rollup body.
    const b = uptimeFromRollups([{ upCount: 100, degradedCount: 10, downCount: 5 }], interval);
    expect(b.upSeconds).toBe(100 * interval);
    expect(b.degradedSeconds).toBe(10 * interval);
    expect(b.downSeconds).toBe(5 * interval);
    expect(b.unknownSeconds).toBe(0);
    // pct = (100 + 0.5*10) / 115 * 100 = 10500/115 ≈ 91.30
    const pct = uptimePercentFromBreakdown(b);
    expect(pct).toBeCloseTo((105 / 115) * 100, 5);
  });

  it('the rollup body + a raw partial-hour top-up merge component-wise', () => {
    const interval = 60;
    const body = uptimeFromRollups([{ upCount: 50, degradedCount: 0, downCount: 0 }], interval);
    // Raw top-up of the current hour: 5 up.
    const topUp = uptimeFromRawResults(
      Array.from({ length: 5 }, (_, i) => ({ checkedAtMs: i * interval * SEC, status: 'up' as const })),
      0,
      5 * interval * SEC,
      interval,
    );
    const merged = mergeBreakdowns(body, {
      upSeconds: topUp.upSeconds,
      degradedSeconds: topUp.degradedSeconds,
      downSeconds: topUp.downSeconds,
      unknownSeconds: 0,
    });
    expect(merged.upSeconds).toBe((50 + 5) * interval);
    expect(uptimePercentFromBreakdown(merged)).toBe(100);
  });

  it('the raw and rollup paths agree for the same underlying sequence', () => {
    const interval = 60;
    const start = 0;
    const end = 4 * interval * SEC;
    // 3 up, 1 down — perfectly spaced.
    const rawResults: RawResultPoint[] = [
      { checkedAtMs: 0, status: 'up' },
      { checkedAtMs: interval * SEC, status: 'up' },
      { checkedAtMs: 2 * interval * SEC, status: 'up' },
      { checkedAtMs: 3 * interval * SEC, status: 'down' },
    ];
    const raw = uptimeFromRawResults(rawResults, start, end, interval);
    const rollup = uptimeFromRollups([{ upCount: 3, degradedCount: 0, downCount: 1 }], interval);
    expect(uptimePercentFromBreakdown(raw)).toBe(uptimePercentFromBreakdown(rollup));
    expect(raw.upSeconds).toBe(rollup.upSeconds);
    expect(raw.downSeconds).toBe(rollup.downSeconds);
  });
});

describe('uptimePercentFromBreakdown — clamping + edge cases', () => {
  it('clamps to [0,100] against floating-point drift', () => {
    expect(
      uptimePercentFromBreakdown({ upSeconds: 100, degradedSeconds: 0, downSeconds: 0, unknownSeconds: 0 }),
    ).toBe(100);
    expect(
      uptimePercentFromBreakdown({ upSeconds: 0, degradedSeconds: 0, downSeconds: 100, unknownSeconds: 0 }),
    ).toBe(0);
  });

  it('unknown seconds never enter the denominator', () => {
    // 50 up, 50 unknown => still 100% (unknown excluded).
    expect(
      uptimePercentFromBreakdown({ upSeconds: 50, degradedSeconds: 0, downSeconds: 0, unknownSeconds: 50 }),
    ).toBe(100);
  });
});
