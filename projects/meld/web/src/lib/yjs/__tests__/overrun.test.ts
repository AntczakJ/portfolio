/**
 * `control.overrun` frame parse tests — ADR-010 §2.
 *
 * The client receives the overrun frame over Stateless (ADR-011) and
 * routes it through `onUnknownControlFrame` into `parseOverrunFrame`.
 * We assert:
 *
 *   - a well-formed overrun frame parses with reason + retry,
 *   - the three known reasons round-trip; an unknown reason normalises
 *     to `'unknown'` (still a recoverable notice),
 *   - a missing / non-numeric / out-of-range `retryAfterMs` clamps to a
 *     safe default / bound,
 *   - a non-overrun frame (welcome, board-deleted) returns `null` so the
 *     handler ignores it,
 *   - malformed input never throws.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OVERRUN_RETRY_MS,
  OVERRUN_REASONS,
  parseOverrunFrame,
} from '../overrun';

describe('parseOverrunFrame — happy path', () => {
  it('parses a well-formed overrun frame', () => {
    const frame = parseOverrunFrame({
      kind: 'control.overrun',
      reason: 'rate.exceeded',
      closeCode: 4290,
      retryAfterMs: 1500,
    });
    expect(frame).not.toBeNull();
    expect(frame?.reason).toBe('rate.exceeded');
    expect(frame?.retryAfterMs).toBe(1500);
  });

  it('accepts all three ADR-004 reason codes', () => {
    for (const reason of OVERRUN_REASONS) {
      const frame = parseOverrunFrame({
        kind: 'control.overrun',
        reason,
        retryAfterMs: 1000,
      });
      expect(frame?.reason).toBe(reason);
    }
  });
});

describe('parseOverrunFrame — reason normalisation', () => {
  it('normalises an unknown reason to "unknown" but still parses', () => {
    const frame = parseOverrunFrame({
      kind: 'control.overrun',
      reason: 'some.future.reason',
      retryAfterMs: 800,
    });
    expect(frame).not.toBeNull();
    expect(frame?.reason).toBe('unknown');
    expect(frame?.retryAfterMs).toBe(800);
  });

  it('handles a missing reason field', () => {
    const frame = parseOverrunFrame({
      kind: 'control.overrun',
      retryAfterMs: 1200,
    });
    expect(frame?.reason).toBe('unknown');
  });
});

describe('parseOverrunFrame — retryAfterMs clamping', () => {
  it('falls back to the default when retryAfterMs is missing', () => {
    const frame = parseOverrunFrame({ kind: 'control.overrun' });
    expect(frame?.retryAfterMs).toBe(DEFAULT_OVERRUN_RETRY_MS);
  });

  it('falls back to the default when retryAfterMs is not a finite number', () => {
    const frame = parseOverrunFrame({
      kind: 'control.overrun',
      retryAfterMs: Number.POSITIVE_INFINITY,
    });
    expect(frame?.retryAfterMs).toBe(DEFAULT_OVERRUN_RETRY_MS);
  });

  it('clamps a hostile small value up to the floor', () => {
    const frame = parseOverrunFrame({
      kind: 'control.overrun',
      retryAfterMs: 10,
    });
    expect(frame?.retryAfterMs).toBeGreaterThanOrEqual(250);
  });

  it('clamps a hostile large value down to the ceiling', () => {
    const frame = parseOverrunFrame({
      kind: 'control.overrun',
      retryAfterMs: 10_000_000,
    });
    expect(frame?.retryAfterMs).toBeLessThanOrEqual(30_000);
  });
});

describe('parseOverrunFrame — non-overrun + malformed', () => {
  it('returns null for a welcome frame', () => {
    expect(parseOverrunFrame({ kind: 'welcome', session: {} })).toBeNull();
  });

  it('returns null for a board-deleted frame', () => {
    expect(
      parseOverrunFrame({ kind: 'control.board-deleted', boardId: 'x' }),
    ).toBeNull();
  });

  it('returns null (does not throw) for arbitrary junk', () => {
    expect(() => parseOverrunFrame(null)).not.toThrow();
    expect(parseOverrunFrame(null)).toBeNull();
    expect(parseOverrunFrame(undefined)).toBeNull();
    expect(parseOverrunFrame(42)).toBeNull();
    expect(parseOverrunFrame('control.overrun')).toBeNull();
    expect(parseOverrunFrame({})).toBeNull();
  });
});
