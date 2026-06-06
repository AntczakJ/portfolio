import { describe, expect, it } from 'vitest';

import {
  formatEta,
  formatEtaLong,
  formatProgress,
  formatRelativeTime,
  formatSpeed,
  progressPercent,
} from '@/lib/fleet/format';

describe('formatEta', () => {
  it('renders m:ss under an hour', () => {
    expect(formatEta(0)).toBe('0:00');
    expect(formatEta(5)).toBe('0:05');
    expect(formatEta(65)).toBe('1:05');
    expect(formatEta(245)).toBe('4:05');
  });

  it('renders h:mm:ss past an hour', () => {
    expect(formatEta(3661)).toBe('1:01:01');
  });

  it('renders an em dash for null / non-finite (no misleading 0:00)', () => {
    expect(formatEta(null)).toBe('—');
    expect(formatEta(Infinity)).toBe('—');
  });

  it('clamps negative to zero', () => {
    expect(formatEta(-10)).toBe('0:00');
  });
});

describe('formatEtaLong', () => {
  it('reads naturally for screen readers', () => {
    expect(formatEtaLong(null)).toBe('unknown');
    expect(formatEtaLong(1)).toBe('1 second');
    expect(formatEtaLong(45)).toBe('45 seconds');
    expect(formatEtaLong(60)).toBe('1 minute');
    expect(formatEtaLong(125)).toBe('2 minutes 5 seconds');
  });
});

describe('formatSpeed', () => {
  it('converts m/s to km/h', () => {
    expect(formatSpeed(0)).toBe('0.0 km/h');
    expect(formatSpeed(10)).toBe('36.0 km/h');
  });
});

describe('progress helpers', () => {
  it('rounds and clamps progress to a whole percent', () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(0.5)).toBe(50);
    expect(progressPercent(1)).toBe(100);
    expect(progressPercent(1.4)).toBe(100);
    expect(progressPercent(-0.2)).toBe(0);
    expect(formatProgress(0.736)).toBe('74%');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 5, 6, 12, 0, 0);
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();

  it('coalesces sub-5s to "now"', () => {
    expect(formatRelativeTime(iso(0), now)).toBe('now');
    expect(formatRelativeTime(iso(3000), now)).toBe('now');
  });

  it('renders seconds / minutes / hours', () => {
    expect(formatRelativeTime(iso(12_000), now)).toBe('12s');
    expect(formatRelativeTime(iso(120_000), now)).toBe('2m');
    expect(formatRelativeTime(iso(7_200_000), now)).toBe('2h');
  });

  it('returns empty for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
