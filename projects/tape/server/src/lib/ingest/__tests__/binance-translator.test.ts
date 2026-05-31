/**
 * BinanceTranslator unit tests — Task 1.3.
 *
 * Covers:
 *  - Field mapping (T -> tsMs, p -> price, q -> qty).
 *  - Aggressor mapping `m === true -> 'sell'`, `m === false -> 'buy'`.
 *  - Symbol normalisation passes through unchanged (the ingestor
 *    supplies the value).
 *  - Zod schema rejects malformed events at the boundary.
 *  - Zod schema coerces decimal-string prices and quantities to f64.
 *  - Zod schema tolerates unknown fields (Binance occasionally adds
 *    new keys without bumping the stream version).
 *
 * Test runner: `bun test`. Mirrors the Task 1.2b TickWriter test
 * pattern.
 */

import { describe, expect, test } from 'bun:test';

import { binanceAggTradeSchema } from '../../schemas/binance/agg-trade';
import {
  aggTradeToTickRow,
  aggTradeToWSTick,
} from '../binance-translator';

const VALID_EVENT_RAW = {
  e: 'aggTrade',
  E: 1735689600000,
  s: 'BTCUSDT',
  a: 12345,
  p: '71234.50',
  q: '0.125',
  f: 100,
  l: 105,
  T: 1735689599998,
  m: false,
};

describe('binanceAggTradeSchema', () => {
  test('coerces decimal-string price and qty to f64 number', () => {
    const parsed = binanceAggTradeSchema.parse(VALID_EVENT_RAW);
    expect(parsed.p).toBe(71234.5);
    expect(parsed.q).toBe(0.125);
  });

  test('accepts a buy-side aggTrade (m=false)', () => {
    const parsed = binanceAggTradeSchema.parse({ ...VALID_EVENT_RAW, m: false });
    expect(parsed.m).toBe(false);
  });

  test('accepts a sell-side aggTrade (m=true)', () => {
    const parsed = binanceAggTradeSchema.parse({ ...VALID_EVENT_RAW, m: true });
    expect(parsed.m).toBe(true);
  });

  test('rejects wrong event type', () => {
    const result = binanceAggTradeSchema.safeParse({
      ...VALID_EVENT_RAW,
      e: 'depthUpdate',
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-positive trade time T', () => {
    expect(
      binanceAggTradeSchema.safeParse({ ...VALID_EVENT_RAW, T: 0 }).success,
    ).toBe(false);
    expect(
      binanceAggTradeSchema.safeParse({ ...VALID_EVENT_RAW, T: -1 }).success,
    ).toBe(false);
  });

  test('rejects negative price', () => {
    expect(
      binanceAggTradeSchema.safeParse({ ...VALID_EVENT_RAW, p: '-100' })
        .success,
    ).toBe(false);
  });

  test('rejects non-numeric price string', () => {
    expect(
      binanceAggTradeSchema.safeParse({ ...VALID_EVENT_RAW, p: 'abc' }).success,
    ).toBe(false);
  });

  test('rejects missing required field', () => {
    const { m: _drop, ...withoutM } = VALID_EVENT_RAW;
    expect(binanceAggTradeSchema.safeParse(withoutM).success).toBe(false);
  });

  test('tolerates unknown extra fields (Binance forward-compat)', () => {
    const parsed = binanceAggTradeSchema.parse({
      ...VALID_EVENT_RAW,
      X: 'PLACEHOLDER',
      r: 0,
    });
    expect(parsed.s).toBe('BTCUSDT');
  });

  test('rejects non-boolean m', () => {
    expect(
      binanceAggTradeSchema.safeParse({ ...VALID_EVENT_RAW, m: 'true' })
        .success,
    ).toBe(false);
  });
});

describe('aggTradeToTickRow', () => {
  test('maps T -> tsMs, s overridden by caller, p / q passed through', () => {
    const event = binanceAggTradeSchema.parse(VALID_EVENT_RAW);
    const row = aggTradeToTickRow(event, 'session-uuid', 'BTCUSDT-PERP');
    expect(row.tsMs).toBe(1735689599998);
    expect(row.symbol).toBe('BTCUSDT-PERP');
    expect(row.price).toBe(71234.5);
    expect(row.qty).toBe(0.125);
    expect(row.sessionId).toBe('session-uuid');
  });

  test('m === true maps to aggressor "sell"', () => {
    const event = binanceAggTradeSchema.parse({
      ...VALID_EVENT_RAW,
      m: true,
    });
    const row = aggTradeToTickRow(event, 'session-uuid', 'BTCUSDT-PERP');
    expect(row.aggressor).toBe('sell');
  });

  test('m === false maps to aggressor "buy"', () => {
    const event = binanceAggTradeSchema.parse({
      ...VALID_EVENT_RAW,
      m: false,
    });
    const row = aggTradeToTickRow(event, 'session-uuid', 'BTCUSDT-PERP');
    expect(row.aggressor).toBe('buy');
  });

  test('does not reach for the wire-level symbol "s"', () => {
    // The caller supplies the normalised symbol; the wire-level
    // `s: 'BTCUSDT'` is intentionally NOT in the persisted row.
    const event = binanceAggTradeSchema.parse({ ...VALID_EVENT_RAW, s: 'ETHUSDT' });
    const row = aggTradeToTickRow(event, 'session-uuid', 'BTCUSDT-PERP');
    expect(row.symbol).toBe('BTCUSDT-PERP');
  });
});

describe('aggTradeToWSTick', () => {
  test('returns the browser-facing tick payload shape', () => {
    const event = binanceAggTradeSchema.parse(VALID_EVENT_RAW);
    const ws = aggTradeToWSTick(event);
    expect(ws).toEqual({
      tsMs: 1735689599998,
      price: 71234.5,
      qty: 0.125,
      aggressor: 'buy',
    });
  });

  test('omits symbol and sessionId from the WS payload', () => {
    const event = binanceAggTradeSchema.parse(VALID_EVENT_RAW);
    const ws = aggTradeToWSTick(event);
    expect('symbol' in ws).toBe(false);
    expect('sessionId' in ws).toBe(false);
  });

  test('aggressor flip matches the tick-row translator', () => {
    const sellEvent = binanceAggTradeSchema.parse({
      ...VALID_EVENT_RAW,
      m: true,
    });
    expect(aggTradeToWSTick(sellEvent).aggressor).toBe('sell');
    const buyEvent = binanceAggTradeSchema.parse({
      ...VALID_EVENT_RAW,
      m: false,
    });
    expect(aggTradeToWSTick(buyEvent).aggressor).toBe('buy');
  });
});
