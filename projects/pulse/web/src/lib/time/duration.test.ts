import { describe, expect, it } from 'vitest';

import { formatDuration, incidentDurationMs } from './duration';

describe('formatDuration', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(47_000)).toBe('47s');
    expect(formatDuration(59_999)).toBe('59s');
  });

  it('renders minutes with zero-padded seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 00s');
    expect(formatDuration(83_000)).toBe('1m 23s');
    expect(formatDuration(60_096)).toBe('1m 00s');
  });

  it('renders hours with zero-padded minutes', () => {
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h 05m');
  });

  it('renders days with zero-padded hours', () => {
    expect(formatDuration(24 * 3_600_000 + 3 * 3_600_000)).toBe('1d 03h');
  });

  it('clamps a negative duration to 0s', () => {
    expect(formatDuration(-5_000)).toBe('0s');
  });

  it('returns a dash for null / NaN', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('incidentDurationMs', () => {
  const started = '2026-06-04T12:00:00.000Z';
  const resolved = '2026-06-04T12:01:00.000Z';

  it('uses the server duration for a closed incident', () => {
    expect(incidentDurationMs(started, resolved, 60_096, 0)).toBe(60_096);
  });

  it('falls back to resolvedAt - startedAt when no server duration', () => {
    expect(incidentDurationMs(started, resolved, null, 0)).toBe(60_000);
  });

  it('ticks up from startedAt for an open incident', () => {
    const now = Date.parse(started) + 28_000;
    expect(incidentDurationMs(started, null, null, now)).toBe(28_000);
  });

  it('clamps clock-skew (now before startedAt) to 0', () => {
    const now = Date.parse(started) - 5_000;
    expect(incidentDurationMs(started, null, null, now)).toBe(0);
  });
});
