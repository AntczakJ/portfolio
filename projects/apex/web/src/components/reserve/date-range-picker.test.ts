import { describe, expect, it } from 'vitest';

import { validateCandidateRange } from './date-range-picker';

/**
 * Sanity coverage for the date-picker rejection-reason helper (A-06). The
 * picker surfaces a SPECIFIC reason on each rejection branch rather than a
 * silent restart, so the reason vocabulary is the load-bearing thing to pin.
 * Phase 7 owns the exhaustive matrix; this guards the branch precedence.
 */

// A fixed window well inside the frozen clock (now = 2026-06-15, 60-day window).
const WINDOW_END = '2026-08-14'; // exclusive

describe('validateCandidateRange', () => {
  it('accepts a clean in-window range with no conflicts', () => {
    expect(
      validateCandidateRange({
        startDay: '2026-06-20',
        to: '2026-06-23', // 3 days
        windowEnd: WINDOW_END,
        bookedDays: new Set<string>(),
      }),
    ).toBeNull();
  });

  it('rejects a range that crosses a booked day (conflict)', () => {
    expect(
      validateCandidateRange({
        startDay: '2026-06-20',
        to: '2026-06-24',
        windowEnd: WINDOW_END,
        bookedDays: new Set(['2026-06-22']),
      }),
    ).toBe('conflict');
  });

  it('rejects a zero-length range (too-short)', () => {
    expect(
      validateCandidateRange({
        startDay: '2026-06-20',
        to: '2026-06-20', // 0 days
        windowEnd: WINDOW_END,
        bookedDays: new Set<string>(),
      }),
    ).toBe('too-short');
  });

  it('rejects a range longer than the maximum (too-long)', () => {
    expect(
      validateCandidateRange({
        startDay: '2026-06-20',
        to: '2026-07-25', // 35 days > MAX (30)
        windowEnd: WINDOW_END,
        bookedDays: new Set<string>(),
      }),
    ).toBe('too-long');
  });

  it('rejects a return day past the bookable window (after-window)', () => {
    expect(
      validateCandidateRange({
        startDay: '2026-08-10',
        to: '2026-08-15', // 5 days, but `to` > windowEnd
        windowEnd: WINDOW_END,
        bookedDays: new Set<string>(),
      }),
    ).toBe('after-window');
  });

  it('prioritises a conflict over a length/window failure', () => {
    // A booked day inside an otherwise too-long range still reports conflict
    // (conflict is checked first — the most specific, actionable reason).
    expect(
      validateCandidateRange({
        startDay: '2026-06-20',
        to: '2026-07-25', // would be too-long
        windowEnd: WINDOW_END,
        bookedDays: new Set(['2026-06-21']),
      }),
    ).toBe('conflict');
  });
});
