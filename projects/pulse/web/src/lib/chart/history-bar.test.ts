import { describe, expect, it } from 'vitest';

import {
  bucketDisplayFill,
  bucketDisplayStatus,
  bucketFill,
  bucketLabel,
  bucketTooltip,
  historyAriaSummary,
  summarizeHistory,
} from './history-bar';
import type { HistoryBucket } from 'pulse-server';

function bucket(
  status: HistoryBucket['status'],
  counts: Partial<Pick<HistoryBucket, 'upCount' | 'degradedCount' | 'downCount'>> = {},
  bucketStart = '2026-06-04T00:00:00.000Z',
): HistoryBucket {
  const hasCounts =
    counts.upCount != null ||
    counts.degradedCount != null ||
    counts.downCount != null;
  // When no explicit counts are given, synthesise counts whose DOMINANT status
  // (H-2) equals the requested status, so a `bucket('down')` reads down etc.
  const defaults =
    hasCounts || status === 'unknown'
      ? { upCount: 0, degradedCount: 0, downCount: 0 }
      : status === 'down'
        ? { upCount: 0, degradedCount: 0, downCount: 60 }
        : status === 'degraded'
          ? { upCount: 30, degradedCount: 30, downCount: 0 }
          : { upCount: 60, degradedCount: 0, downCount: 0 };
  return {
    bucketStart,
    status,
    upCount: counts.upCount ?? defaults.upCount,
    degradedCount: counts.degradedCount ?? defaults.degradedCount,
    downCount: counts.downCount ?? defaults.downCount,
  };
}

describe('bucketFill (status -> sovereign token fill class)', () => {
  it('maps each status to its status fill token', () => {
    expect(bucketFill('up')).toBe('fill-status-up');
    expect(bucketFill('degraded')).toBe('fill-status-degraded');
    expect(bucketFill('down')).toBe('fill-status-down');
    expect(bucketFill('unknown')).toBe('fill-status-unknown');
  });

  it('falls back to the unknown fill for an unexpected status', () => {
    expect(bucketFill('bogus' as HistoryBucket['status'])).toBe(
      'fill-status-unknown',
    );
  });
});

describe('bucketDisplayStatus (H-2 dominant-status coloring)', () => {
  it('reads a mostly-up bucket as up even with a stray down check', () => {
    // 97% up, 3% down — the real-world case the critic flagged (near-solid red
    // bar while the card showed 97%). Must read green.
    expect(
      bucketDisplayStatus(bucket('down', { upCount: 97, downCount: 3 })),
    ).toBe('up');
  });

  it('reads a bucket as down only when the down-share crosses 50%', () => {
    expect(
      bucketDisplayStatus(bucket('down', { upCount: 40, downCount: 60 })),
    ).toBe('down');
    expect(
      bucketDisplayStatus(bucket('down', { upCount: 60, downCount: 40 })),
    ).toBe('degraded');
  });

  it('reads degraded when the non-up share crosses the amber threshold', () => {
    expect(
      bucketDisplayStatus(bucket('degraded', { upCount: 80, degradedCount: 20 })),
    ).toBe('degraded');
  });

  it('preserves a no-data (unknown) bucket and an all-zero bucket', () => {
    expect(bucketDisplayStatus(bucket('unknown'))).toBe('unknown');
    expect(
      bucketDisplayStatus(bucket('up', { upCount: 0, downCount: 0 })),
    ).toBe('unknown');
  });

  it('bucketDisplayFill maps the dominant status to the fill token', () => {
    expect(bucketDisplayFill(bucket('down', { upCount: 97, downCount: 3 }))).toBe(
      'fill-status-up',
    );
    expect(bucketDisplayFill(bucket('down', { upCount: 10, downCount: 90 }))).toBe(
      'fill-status-down',
    );
  });
});

describe('bucketLabel', () => {
  it('uses the Statuspage register (Operational, not up)', () => {
    expect(bucketLabel('up')).toBe('Operational');
    expect(bucketLabel('degraded')).toBe('Degraded');
    expect(bucketLabel('down')).toBe('Down');
    expect(bucketLabel('unknown')).toBe('No data');
  });
});

describe('bucketTooltip', () => {
  const fmt = (s: number, e: number) => `${String(s)}-${String(e)}`;

  it('includes the range, the status label and the check counts', () => {
    // Down-dominant (>= 50% down) so the tooltip label reads "Down" (H-2).
    const b = bucket('down', { upCount: 3, downCount: 5, degradedCount: 1 });
    const text = bucketTooltip(b, 3600, fmt);
    expect(text).toContain('Down');
    expect(text).toContain('5 down');
    expect(text).toContain('1 degraded');
    expect(text).toContain('3 up');
    expect(text).toContain('of 9'); // total
  });

  it('labels a mostly-up bucket Operational even with a stray failure (H-2)', () => {
    // 1 down of 60 = ~1.6% — must read Operational (green), not Down.
    const b = bucket('down', { upCount: 59, downCount: 1, degradedCount: 0 });
    const text = bucketTooltip(b, 3600, fmt);
    expect(text).toContain('Operational');
  });

  it('omits counts for an unknown (no-data) bucket', () => {
    const b = bucket('unknown');
    const text = bucketTooltip(b, 3600, fmt);
    expect(text).toContain('No data');
    expect(text).not.toContain('of 0');
  });

  it('computes the end of the range from bucketSeconds', () => {
    const startMs = Date.parse('2026-06-04T00:00:00.000Z');
    const b = bucket('up', { upCount: 10 });
    const text = bucketTooltip(b, 3600, (s, e) => {
      expect(s).toBe(startMs);
      expect(e).toBe(startMs + 3600 * 1000);
      return 'range';
    });
    expect(text).toContain('range');
  });
});

describe('summarizeHistory', () => {
  it('counts BARS by status (not the checks inside them)', () => {
    const s = summarizeHistory([
      bucket('up', { upCount: 100 }),
      bucket('up'),
      bucket('degraded'),
      bucket('down'),
      bucket('unknown'),
    ]);
    expect(s).toEqual({ total: 5, up: 2, degraded: 1, down: 1, unknown: 1 });
  });

  it('handles an empty strip', () => {
    expect(summarizeHistory([])).toEqual({
      total: 0,
      up: 0,
      degraded: 0,
      down: 0,
      unknown: 0,
    });
  });
});

describe('historyAriaSummary (the non-color channel)', () => {
  it('reads observed vs total and lists the present statuses', () => {
    const summary = historyAriaSummary(
      [bucket('up'), bucket('up'), bucket('down'), bucket('unknown')],
      'the last 30 days',
    );
    expect(summary).toContain('the last 30 days');
    expect(summary).toContain('3 of 4 intervals observed'); // up+down counted, unknown excluded
    expect(summary).toContain('2 operational');
    expect(summary).toContain('1 down');
    expect(summary).toContain('1 with no data');
  });

  it('omits absent statuses but always reports operational', () => {
    const summary = historyAriaSummary([bucket('up'), bucket('up')], '24h');
    expect(summary).toContain('2 operational');
    expect(summary).not.toContain('degraded');
    expect(summary).not.toContain('down');
  });
});
