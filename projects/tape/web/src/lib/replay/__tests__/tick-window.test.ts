import { describe, expect, it } from 'vitest';

import { computeTickWindow, dayStartMs, TICK_WINDOW_MS } from '../tick-window';

const DAY_MS = 86_400_000;

describe('dayStartMs', () => {
  it('resolves a YYYY-MM-DD to UTC midnight epoch-ms', () => {
    // 2026-06-04T00:00:00Z.
    expect(dayStartMs('2026-06-04')).toBe(Date.UTC(2026, 5, 4));
  });
});

describe('computeTickWindow', () => {
  const dayStart = Date.UTC(2026, 5, 4);

  it('returns a trailing window ending at the absolute cursor', () => {
    // Cursor 1h into the day.
    const cursor = 3_600_000;
    const w = computeTickWindow(dayStart, cursor, DAY_MS);
    expect(w.to).toBe(dayStart + cursor);
    expect(w.from).toBe(dayStart + cursor - TICK_WINDOW_MS);
    expect(w.to - w.from).toBe(TICK_WINDOW_MS);
  });

  it('clamps `from` to the day start near session open', () => {
    // Cursor only 10 s in — the trailing 90 s window would precede the
    // day, so `from` clamps to the day start.
    const w = computeTickWindow(dayStart, 10_000, DAY_MS);
    expect(w.from).toBe(dayStart);
    expect(w.to).toBe(dayStart + 10_000);
  });

  it('clamps `to` to the day end past the day length', () => {
    const w = computeTickWindow(dayStart, DAY_MS + 5_000, DAY_MS);
    expect(w.to).toBe(dayStart + DAY_MS);
  });

  it('clamps a negative cursor to session open', () => {
    const w = computeTickWindow(dayStart, -1000, DAY_MS);
    expect(w.from).toBe(dayStart);
    expect(w.to).toBe(dayStart);
  });

  it('honours a custom window length', () => {
    const w = computeTickWindow(dayStart, 3_600_000, DAY_MS, 30_000);
    expect(w.to - w.from).toBe(30_000);
  });

  it('always returns from <= to', () => {
    for (const cursor of [0, 100, 90_000, DAY_MS / 2, DAY_MS]) {
      const w = computeTickWindow(dayStart, cursor, DAY_MS);
      expect(w.from).toBeLessThanOrEqual(w.to);
    }
  });
});
