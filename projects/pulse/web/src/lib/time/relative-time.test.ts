import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './relative-time';

const NOW = 1_700_000_000_000;

describe('formatRelativeTime', () => {
  it('reads "never" for null / undefined / NaN', () => {
    expect(formatRelativeTime(null, NOW)).toBe('never');
    expect(formatRelativeTime(undefined, NOW)).toBe('never');
    expect(formatRelativeTime(Number.NaN, NOW)).toBe('never');
  });

  it('reads "just now" within 2 seconds', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 1_000, NOW)).toBe('just now');
  });

  it('reads seconds under a minute', () => {
    expect(formatRelativeTime(NOW - 12_000, NOW)).toBe('12s ago');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('59s ago');
  });

  it('reads minutes under an hour', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59m ago');
  });

  it('reads hours under a day', () => {
    expect(formatRelativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2h ago');
  });

  it('reads days beyond a day', () => {
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3d ago');
  });

  it('clamps a future timestamp to "just now" (never negative)', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('just now');
  });
});
