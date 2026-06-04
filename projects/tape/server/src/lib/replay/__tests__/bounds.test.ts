/**
 * Replay input-validation + day-bounds math — Task 1.7 gate.
 *
 * Pure, DB-free. Covers the fail-closed validation contract (symbol
 * allowlist, strict `YYYY-MM-DD`, non-real days) and the
 * `[dayStartMs, dayEndMs)` UTC epoch-ms math including month / year
 * boundaries and a leap-year case. Runs via `pnpm -F tape-server test`
 * (Bun's `bun test`).
 */

import { describe, expect, test } from 'bun:test';

import {
  DAY_MS,
  REPLAY_V1_SYMBOL,
  computeReplayBounds,
  computeTickWindow,
  resolveSymbol,
  type ReplayBounds,
} from '../bounds';

describe('resolveSymbol', () => {
  test('resolves the canonical exchange-qualified form', () => {
    expect(resolveSymbol('BTCUSDT-PERP')).toBe('BTCUSDT-PERP');
  });

  test('resolves the short brand form to the canonical symbol', () => {
    expect(resolveSymbol('BTC-PERP')).toBe('BTCUSDT-PERP');
  });

  test('is case-insensitive on the alias key', () => {
    expect(resolveSymbol('btc-perp')).toBe('BTCUSDT-PERP');
    expect(resolveSymbol('btcusdt-perp')).toBe('BTCUSDT-PERP');
  });

  test('returns null for an off-allowlist symbol (fail-closed)', () => {
    expect(resolveSymbol('ETH-PERP')).toBeNull();
    expect(resolveSymbol('SOLUSDT-PERP')).toBeNull();
    expect(resolveSymbol('')).toBeNull();
    expect(resolveSymbol('../etc/passwd')).toBeNull();
  });

  test('the canonical v1 symbol constant matches the resolved value', () => {
    expect(REPLAY_V1_SYMBOL).toBe('BTCUSDT-PERP');
    expect(resolveSymbol(REPLAY_V1_SYMBOL)).toBe(REPLAY_V1_SYMBOL);
  });
});

describe('computeReplayBounds — symbol validation', () => {
  test('rejects an unknown symbol with field: symbol', () => {
    const r = computeReplayBounds('DOGE-PERP', '2026-06-01');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('symbol');
  });

  test('accepts a known symbol + valid date', () => {
    const r = computeReplayBounds('BTC-PERP', '2026-06-01');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bounds.symbol).toBe('BTCUSDT-PERP');
  });
});

describe('computeReplayBounds — date validation (fail-closed)', () => {
  test.each([
    ['2026-6-1', 'non-zero-padded month and day'],
    ['2026-06-1', 'non-zero-padded day'],
    ['26-06-01', 'two-digit year'],
    ['2026/06/01', 'slash separators'],
    ['2026-06-01T00:00:00Z', 'trailing time component'],
    ['2026-06-01 ', 'trailing whitespace'],
    [' 2026-06-01', 'leading whitespace'],
    ['', 'empty string'],
    ['not-a-date', 'garbage'],
    ['2026-00-01', 'month 00'],
    ['2026-13-01', 'month 13'],
    ['2026-06-00', 'day 00'],
    ['2026-06-31', 'June has 30 days'],
    ['2026-02-29', '2026 is not a leap year'],
    ['2026-02-30', 'February never has 30 days'],
  ])('rejects %p (%s) with field: date', (raw) => {
    const r = computeReplayBounds('BTC-PERP', raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('date');
  });

  test.each([
    '2026-06-01',
    '2026-01-01',
    '2026-12-31',
    '2024-02-29', // 2024 IS a leap year — Feb 29 is real
    '2000-02-29', // century leap year (div by 400)
    '2026-02-28',
  ])('accepts the real calendar day %p', (raw) => {
    const r = computeReplayBounds('BTC-PERP', raw);
    expect(r.ok).toBe(true);
  });
});

describe('computeReplayBounds — UTC day-bounds math', () => {
  function bounds(date: string): ReplayBounds {
    const r = computeReplayBounds('BTC-PERP', date);
    if (!r.ok) throw new Error(`expected ok for ${date}`);
    return r.bounds;
  }

  test('dayStartMs is 00:00:00.000 UTC of the requested day', () => {
    const b = bounds('2026-06-01');
    expect(b.dayStartMs).toBe(Date.UTC(2026, 5, 1));
    expect(new Date(b.dayStartMs).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  test('dayEndMs is exactly one UTC day later (exclusive upper bound)', () => {
    const b = bounds('2026-06-01');
    expect(b.dayEndMs).toBe(b.dayStartMs + DAY_MS);
    expect(new Date(b.dayEndMs).toISOString()).toBe(
      '2026-06-02T00:00:00.000Z',
    );
  });

  test('the interval is exactly 86_400_000 ms wide', () => {
    const b = bounds('2026-03-15');
    expect(b.dayEndMs - b.dayStartMs).toBe(DAY_MS);
  });

  test('month boundary: 2026-01-31 → 2026-02-01', () => {
    const b = bounds('2026-01-31');
    expect(new Date(b.dayStartMs).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
    expect(new Date(b.dayEndMs).toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  test('year boundary: 2026-12-31 → 2027-01-01', () => {
    const b = bounds('2026-12-31');
    expect(new Date(b.dayStartMs).toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
    expect(new Date(b.dayEndMs).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  test('leap-year boundary: 2024-02-29 → 2024-03-01', () => {
    const b = bounds('2024-02-29');
    expect(new Date(b.dayStartMs).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    expect(new Date(b.dayEndMs).toISOString()).toBe(
      '2024-03-01T00:00:00.000Z',
    );
  });

  test('non-leap February end: 2026-02-28 → 2026-03-01', () => {
    const b = bounds('2026-02-28');
    expect(new Date(b.dayEndMs).toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  test('the validated date is echoed back on the bounds', () => {
    expect(bounds('2026-06-01').date).toBe('2026-06-01');
  });
});

describe('computeTickWindow', () => {
  const b = (() => {
    const r = computeReplayBounds('BTC-PERP', '2026-06-01');
    if (!r.ok) throw new Error('setup');
    return r.bounds;
  })();

  test('defaults to the full day when from/to are omitted', () => {
    const w = computeTickWindow(b, undefined, undefined);
    expect(w).not.toBeNull();
    expect(w?.fromMs).toBe(b.dayStartMs);
    expect(w?.toMs).toBe(b.dayEndMs);
  });

  test('accepts a bounded window inside the day', () => {
    const from = b.dayStartMs + 3_600_000; // +1h
    const to = b.dayStartMs + 7_200_000; // +2h
    const w = computeTickWindow(b, String(from), String(to));
    expect(w).toEqual({ fromMs: from, toMs: to });
  });

  test('clamps a from before the day start up to the day start', () => {
    const w = computeTickWindow(b, '0', String(b.dayStartMs + 1_000));
    expect(w?.fromMs).toBe(b.dayStartMs);
    expect(w?.toMs).toBe(b.dayStartMs + 1_000);
  });

  test('clamps a to past the day end down to the day end', () => {
    const w = computeTickWindow(
      b,
      String(b.dayEndMs - 1_000),
      String(b.dayEndMs + 999_999),
    );
    expect(w?.fromMs).toBe(b.dayEndMs - 1_000);
    expect(w?.toMs).toBe(b.dayEndMs);
  });

  test('collapses a fully-out-of-day window to an empty window', () => {
    // Both before the day: clamps from up to dayStart, to up to dayStart.
    const w = computeTickWindow(b, '0', '1000');
    expect(w).not.toBeNull();
    expect(w?.fromMs).toBe(w?.toMs); // empty → zero rows
  });

  test('allows an explicitly empty window (from === to)', () => {
    const mid = b.dayStartMs + 1_000;
    const w = computeTickWindow(b, String(mid), String(mid));
    expect(w).toEqual({ fromMs: mid, toMs: mid });
  });

  test.each([
    ['1.5', '2000', 'non-integer from'],
    ['1000', '2000.7', 'non-integer to'],
    ['-1', '2000', 'negative from'],
    ['1000', '-2000', 'negative to'],
    ['5000', '1000', 'inverted from > to'],
    ['abc', '2000', 'NaN from'],
    ['1000', 'xyz', 'NaN to'],
  ])('rejects malformed window (%p,%p — %s)', (from, to) => {
    expect(computeTickWindow(b, from, to)).toBeNull();
  });
});
