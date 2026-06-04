import { describe, expect, it } from 'vitest';

import {
  bucketRawResults,
  bucketRollups,
  type RawHistoryPoint,
  type RollupHistoryBucket,
} from './history-bucketing';

/**
 * History-bucketing invariants (ADR-004 status strip). Worst status wins
 * (down > degraded > up), empty spans are `unknown`, and the bucket count /
 * boundaries are exact.
 */

const SEC = 1000;
const HOUR = 60 * 60 * SEC;

describe('bucketRawResults', () => {
  it('produces exactly bucketCount buckets across the window', () => {
    const buckets = bucketRawResults([], 0, 90 * SEC, 90);
    expect(buckets).toHaveLength(90);
    // No data => every bucket is unknown.
    expect(buckets.every((b) => b.status === 'unknown')).toBe(true);
  });

  it('worst status wins within a bucket (down > degraded > up)', () => {
    // One bucket spanning [0, 60s). Mix up + degraded + down in it.
    const results: RawHistoryPoint[] = [
      { checkedAtMs: 1 * SEC, status: 'up' },
      { checkedAtMs: 2 * SEC, status: 'degraded' },
      { checkedAtMs: 3 * SEC, status: 'down' },
      { checkedAtMs: 4 * SEC, status: 'up' },
    ];
    const buckets = bucketRawResults(results, 0, 60 * SEC, 1);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ status: 'down', upCount: 2, degradedCount: 1, downCount: 1 });
  });

  it('degraded wins over up when there is no down', () => {
    const results: RawHistoryPoint[] = [
      { checkedAtMs: 1 * SEC, status: 'up' },
      { checkedAtMs: 2 * SEC, status: 'degraded' },
    ];
    const buckets = bucketRawResults(results, 0, 60 * SEC, 1);
    expect(buckets[0]?.status).toBe('degraded');
  });

  it('places results into the correct bucket by time', () => {
    // 3 buckets across [0, 90s): [0,30), [30,60), [60,90).
    const results: RawHistoryPoint[] = [
      { checkedAtMs: 5 * SEC, status: 'up' }, // bucket 0
      { checkedAtMs: 45 * SEC, status: 'down' }, // bucket 1
      // bucket 2 has no data => unknown
    ];
    const buckets = bucketRawResults(results, 0, 90 * SEC, 3);
    expect(buckets.map((b) => b.status)).toEqual(['up', 'down', 'unknown']);
  });

  it('ignores results outside the window', () => {
    const results: RawHistoryPoint[] = [
      { checkedAtMs: -10 * SEC, status: 'down' }, // before window
      { checkedAtMs: 200 * SEC, status: 'down' }, // after window
      { checkedAtMs: 10 * SEC, status: 'up' }, // inside
    ];
    const buckets = bucketRawResults(results, 0, 60 * SEC, 1);
    expect(buckets[0]).toMatchObject({ status: 'up', downCount: 0 });
  });

  it('a point exactly at the window end belongs to no bucket (end exclusive)', () => {
    const results: RawHistoryPoint[] = [{ checkedAtMs: 60 * SEC, status: 'down' }];
    const buckets = bucketRawResults(results, 0, 60 * SEC, 1);
    expect(buckets[0]?.status).toBe('unknown');
  });
});

describe('bucketRollups', () => {
  it('folds multiple rollup hours into one wider strip bucket (counts sum, worst wins)', () => {
    // Window 6h, 3 strip buckets => each strip bucket is 2h wide.
    const windowStart = 0;
    const windowEnd = 6 * HOUR;
    const rollups: RollupHistoryBucket[] = [
      { bucketStartMs: 0 * HOUR, upCount: 10, degradedCount: 0, downCount: 0 },
      { bucketStartMs: 1 * HOUR, upCount: 8, degradedCount: 2, downCount: 0 }, // same strip bucket 0
      { bucketStartMs: 2 * HOUR, upCount: 10, degradedCount: 0, downCount: 1 }, // strip bucket 1
      // strip bucket 2 (4h-6h) has no rollups => unknown
    ];
    const buckets = bucketRollups(rollups, windowStart, windowEnd, 3);
    expect(buckets).toHaveLength(3);
    // Bucket 0 folds hours 0 + 1: 18 up, 2 degraded, 0 down => degraded.
    expect(buckets[0]).toMatchObject({ upCount: 18, degradedCount: 2, status: 'degraded' });
    // Bucket 1 (hour 2) has a down => down. Bucket 2 is empty => unknown.
    expect(buckets.map((b) => b.status)).toEqual(['degraded', 'down', 'unknown']);
  });

  it('produces exactly bucketCount buckets', () => {
    const buckets = bucketRollups([], 0, 30 * 24 * HOUR, 90);
    expect(buckets).toHaveLength(90);
    expect(buckets.every((b) => b.status === 'unknown')).toBe(true);
  });
});
