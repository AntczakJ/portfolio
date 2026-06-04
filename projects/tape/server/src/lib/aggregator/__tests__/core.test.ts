/**
 * Footprint-cell aggregator — reference-impl unit suite (Task 1.4).
 *
 * Runner: bun test. Mirrors the existing co-located __tests__ style.
 *
 * Coverage map (every item is required by PLAN.md Task 1.4 + the task
 * brief's edge-case list):
 *   - aggressor → side mapping (buy ⇒ ask_volume, sell ⇒ bid_volume).
 *   - per-cell invariant: bid_volume + ask_volume == total traded
 *     volume; trades == count of contributing ticks.
 *   - bucketing: 1-min time buckets, $5 price-bucket INDEX, boundary
 *     tick belongs to the new bar.
 *   - bar rollover emits cell.close with absolute totals.
 *   - mid-bar cell.delta emission carries this tick's contribution only.
 *   - CVD: barDelta = ask - bid, CVD = running cumulative, reversal on
 *     sign flip, steps only on bars that traded (gap = no step).
 *   - edge cases: out-of-order tick, duplicate tick, gap across an empty
 *     bar, tick exactly on a boundary.
 *   - purity / determinism: same input ⇒ same output across two runs.
 *   - fixture conformance: the committed __fixtures__ oracle reproduces
 *     exactly (this is the SAME oracle the Rust port + Task 5.2 use).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { AggregatorCore } from '../core';
import { PRICE_BUCKET_USD, priceBucket, TIME_BUCKET_MS, timeBucket } from '../bucketing';
import type { AggregatorTick } from '../types';
import {
  replayFixture,
  type AggregatorExpectedFixture,
  type AggregatorInputFixture,
} from '../replay';

const SYMBOL = 'BTCUSDT-PERP';

function tick(
  tsMs: number,
  price: number,
  qty: number,
  aggressor: 'buy' | 'sell',
  symbol = SYMBOL,
): AggregatorTick {
  return { tsMs, symbol, price, qty, aggressor };
}

describe('bucketing helpers', () => {
  test('timeBucket floors to the 1-minute boundary', () => {
    expect(timeBucket(0)).toBe(0);
    expect(timeBucket(59_999)).toBe(0);
    expect(timeBucket(60_000)).toBe(60_000);
    expect(timeBucket(60_001)).toBe(60_000);
    expect(TIME_BUCKET_MS).toBe(60_000);
  });

  test('priceBucket floors to a $5 INDEX (not a USD price)', () => {
    expect(PRICE_BUCKET_USD).toBe(5);
    expect(priceBucket(0)).toBe(0);
    expect(priceBucket(4.99)).toBe(0);
    expect(priceBucket(5)).toBe(1);
    expect(priceBucket(7.5)).toBe(1);
    // Parity anchors with the Rust bucketing test.
    expect(priceBucket(71_234.5)).toBe(14_246);
    expect(priceBucket(71_235)).toBe(14_247);
  });
});

describe('aggressor -> footprint side mapping', () => {
  test('buy aggressor adds to ASK volume (taker lifted the ask)', () => {
    const agg = new AggregatorCore();
    const [frame] = agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy'));
    expect(frame?.kind).toBe('cell.delta');
    if (frame?.kind !== 'cell.delta') throw new Error('expected delta');
    expect(frame.payload.askVolumeDelta).toBe(0.5);
    expect(frame.payload.bidVolumeDelta).toBe(0);
  });

  test('sell aggressor adds to BID volume (taker hit the bid)', () => {
    const agg = new AggregatorCore();
    const [frame] = agg.onTick(tick(1_000, 71_234.5, 0.25, 'sell'));
    if (frame?.kind !== 'cell.delta') throw new Error('expected delta');
    expect(frame.payload.bidVolumeDelta).toBe(0.25);
    expect(frame.payload.askVolumeDelta).toBe(0);
  });
});

describe('mid-bar cell.delta emission', () => {
  test('each onTick emits exactly one delta carrying THIS tick only', () => {
    const agg = new AggregatorCore();
    const first = agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy'));
    const second = agg.onTick(tick(2_000, 71_234.5, 0.25, 'buy'));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // The second delta is NOT cumulative — it carries 0.25, not 0.75.
    if (second[0]?.kind !== 'cell.delta') throw new Error('expected delta');
    expect(second[0].payload.askVolumeDelta).toBe(0.25);
    expect(second[0].payload.tradesDelta).toBe(1);
  });

  test('open-bar running totals are visible via snapshot', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy'));
    agg.onTick(tick(2_000, 71_234.5, 0.25, 'sell'));
    const snap = agg.snapshot();
    expect(snap.cellsOpen).toHaveLength(1);
    const cell = snap.cellsOpen[0];
    expect(cell?.askVolumeDelta).toBe(0.5);
    expect(cell?.bidVolumeDelta).toBe(0.25);
    expect(cell?.tradesDelta).toBe(2);
    expect(snap.ticksProcessed).toBe(2);
  });
});

describe('per-cell invariants', () => {
  test('bid_volume + ask_volume == total traded volume, trades == tick count', () => {
    const agg = new AggregatorCore();
    const ticks = [
      tick(1_000, 71_234.5, 0.5, 'buy'),
      tick(2_000, 71_234.5, 0.25, 'sell'),
      tick(3_000, 71_234.5, 0.125, 'buy'),
    ];
    let totalVolume = 0;
    for (const t of ticks) {
      totalVolume += t.qty;
      agg.onTick(t);
    }
    const { frames } = agg.closeExpired(60_001);
    const closes = frames.filter((f) => f.kind === 'cell.close');
    expect(closes).toHaveLength(1);
    const close = closes[0];
    if (close?.kind !== 'cell.close') throw new Error('expected close');
    expect(close.payload.bidVolume + close.payload.askVolume).toBeCloseTo(
      totalVolume,
      10,
    );
    expect(close.payload.trades).toBe(ticks.length);
  });
});

describe('bar bucketing and rollover', () => {
  test('distinct price buckets create separate cells', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy'));
    agg.onTick(tick(2_000, 71_240.0, 0.5, 'buy'));
    expect(agg.cellsOpen).toBe(2);
  });

  test('tick exactly on a bar boundary belongs to the NEW bar', () => {
    const agg = new AggregatorCore();
    const [frame] = agg.onTick(tick(60_000, 71_250.0, 1.0, 'sell'));
    if (frame?.kind !== 'cell.delta') throw new Error('expected delta');
    expect(frame.payload.bucketTs).toBe(60_000);
  });

  test('closeExpired emits cell.close once a bar has ended and removes it', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.4, 'buy'));
    agg.onTick(tick(5_000, 71_234.5, 0.1, 'sell'));
    expect(agg.cellsOpen).toBe(1);
    const { frames } = agg.closeExpired(60_001);
    expect(frames).toHaveLength(1);
    const close = frames[0];
    if (close?.kind !== 'cell.close') throw new Error('expected close');
    expect(close.payload.bucketTs).toBe(0);
    expect(close.payload.askVolume).toBe(0.4);
    expect(close.payload.bidVolume).toBe(0.1);
    expect(close.payload.trades).toBe(2);
    // tsMs on close == last contributing tick, not the bar boundary.
    expect(close.payload.tsMs).toBe(5_000);
    expect(agg.cellsOpen).toBe(0);
  });

  test('closeExpired is a no-op while the bar is still open', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy'));
    const { frames, cvd } = agg.closeExpired(30_000);
    expect(frames).toHaveLength(0);
    expect(cvd).toHaveLength(0);
    expect(agg.cellsOpen).toBe(1);
  });

  test('an earlier bar closes even while a later bar stays open', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy')); // bucket 0
    agg.onTick(tick(70_000, 71_234.5, 0.5, 'buy')); // bucket 60000
    // 90_001 ends bucket 0 (closed at 60000) but NOT bucket 60000
    // (ends at 120000).
    const { frames } = agg.closeExpired(90_001);
    expect(frames).toHaveLength(1);
    if (frames[0]?.kind !== 'cell.close') throw new Error('expected close');
    expect(frames[0].payload.bucketTs).toBe(0);
    expect(agg.cellsOpen).toBe(1);
  });

  test('drainAll closes every open cell and empties the aggregator', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy'));
    agg.onTick(tick(1_000, 71_240.0, 0.5, 'sell'));
    const { frames } = agg.drainAll();
    expect(frames).toHaveLength(2);
    expect(agg.cellsOpen).toBe(0);
  });
});

describe('CVD rollup', () => {
  test('barDelta = ask - bid; CVD is the running cumulative across bars', () => {
    const agg = new AggregatorCore();
    // Bar 0: net buying.
    agg.onTick(tick(1_000, 71_000.0, 1.0, 'buy')); // ask 1.0
    agg.onTick(tick(2_000, 71_000.0, 0.25, 'sell')); // bid 0.25
    const bar0 = agg.closeExpired(60_001).cvd;
    expect(bar0).toHaveLength(1);
    expect(bar0[0]?.barDelta).toBeCloseTo(0.75, 10);
    expect(bar0[0]?.cvd).toBeCloseTo(0.75, 10);
    expect(agg.cvd(SYMBOL)).toBeCloseTo(0.75, 10);
  });

  test('CVD reverses direction exactly when a bar barDelta flips sign', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_000.0, 1.0, 'buy'));
    agg.onTick(tick(2_000, 71_000.0, 0.25, 'sell'));
    agg.closeExpired(60_001); // CVD 0.75
    // Bar 1: net selling.
    agg.onTick(tick(61_000, 71_005.0, 0.25, 'buy'));
    agg.onTick(tick(62_000, 71_005.0, 1.0, 'sell'));
    const bar1 = agg.closeExpired(120_001).cvd;
    expect(bar1).toHaveLength(1);
    expect(bar1[0]?.barDelta).toBeCloseTo(-0.75, 10);
    // 0.75 + (-0.75) = 0 — CVD fell (reversed) on the sign flip.
    expect(bar1[0]?.cvd).toBeCloseTo(0, 10);
  });

  test('CVD steps only on bars that traded (an empty bar does not step)', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_000.0, 1.0, 'buy')); // bar 0
    // Bar 1 (bucketTs 60000) gets NO ticks — a gap.
    agg.onTick(tick(121_000, 71_010.0, 0.5, 'buy')); // bar 2
    const all = agg.drainAll().cvd;
    // Only two rollups: bar 0 and bar 2. The empty bar 1 never existed
    // in the open map, so it produces no rollup and does not step CVD.
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.bucketTs)).toEqual([0, 120_000]);
  });
});

describe('edge cases', () => {
  test('out-of-order tick accumulates into its bucket and bumps the counter only', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(2_000, 71_234.5, 0.25, 'buy'));
    // Late tick — earlier tsMs, same still-open bucket.
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'sell'));
    expect(agg.outOfOrderTicks).toBe(1);
    const snap = agg.snapshot();
    expect(snap.cellsOpen).toHaveLength(1);
    // Both ticks landed in the same cell — accumulation is bucket-
    // addressed, not order-dependent.
    expect(snap.cellsOpen[0]?.askVolumeDelta).toBe(0.25);
    expect(snap.cellsOpen[0]?.bidVolumeDelta).toBe(0.5);
    expect(snap.cellsOpen[0]?.tradesDelta).toBe(2);
  });

  test('duplicate tick counts as a real trade and bumps the duplicate counter', () => {
    const agg = new AggregatorCore();
    const t = tick(5_000, 71_240.0, 0.1, 'sell');
    agg.onTick(t);
    agg.onTick({ ...t }); // exact duplicate
    expect(agg.duplicateTicks).toBe(1);
    const snap = agg.snapshot();
    expect(snap.cellsOpen[0]?.bidVolumeDelta).toBeCloseTo(0.2, 10);
    expect(snap.cellsOpen[0]?.tradesDelta).toBe(2);
  });

  test('a genuine same-ms second trade is indistinguishable from a dup (counted, by design)', () => {
    const agg = new AggregatorCore();
    // Same ts but DIFFERENT qty/aggressor — not an exact dup, no counter.
    agg.onTick(tick(5_000, 71_240.0, 0.1, 'sell'));
    agg.onTick(tick(5_000, 71_240.0, 0.2, 'buy'));
    expect(agg.duplicateTicks).toBe(0);
  });

  test('concurrent symbols stay isolated in the open map and on close', () => {
    const agg = new AggregatorCore();
    agg.onTick(tick(1_000, 71_234.5, 0.5, 'buy', 'BTCUSDT-PERP'));
    agg.onTick(tick(1_000, 3_500.0, 1.0, 'sell', 'ETHUSDT-PERP'));
    expect(agg.cellsOpen).toBe(2);
    const { frames, cvd } = agg.closeExpired(60_001);
    expect(frames).toHaveLength(2);
    // One rollup per symbol, deterministically ordered (BTC before ETH).
    expect(cvd.map((r) => r.symbol)).toEqual(['BTCUSDT-PERP', 'ETHUSDT-PERP']);
  });
});

describe('session extreme', () => {
  test('tracks the max trade-count any cell has reached per symbol', () => {
    const agg = new AggregatorCore();
    for (let i = 0; i < 3; i++) {
      agg.onTick(tick(1_000 + i, 71_234.5, 0.1, 'buy'));
    }
    agg.onTick(tick(1_500, 71_240.0, 0.1, 'buy')); // different bucket, 1 trade
    expect(agg.sessionExtreme(SYMBOL)).toBe(3);
    agg.onTick(tick(1_600, 3_500.0, 1.0, 'buy', 'ETHUSDT-PERP'));
    expect(agg.sessionExtreme('ETHUSDT-PERP')).toBe(1);
    expect(agg.sessionExtreme(SYMBOL)).toBe(3);
  });
});

describe('purity and determinism', () => {
  test('replaying the same ticks yields identical frames (no clock, no global state)', () => {
    const ticks = [
      tick(1_000, 71_234.5, 0.5, 'buy'),
      tick(2_000, 71_234.5, 0.25, 'sell'),
      tick(70_000, 71_240.0, 0.125, 'buy'),
    ];
    const run = (): string => {
      const agg = new AggregatorCore();
      const out: unknown[] = [];
      for (const t of ticks) out.push(...agg.onTick(t));
      out.push(agg.closeExpired(120_001));
      out.push(agg.snapshot());
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });

  test('snapshot cellsOpen is sorted by (symbol, bucketTs, priceBucket)', () => {
    const agg = new AggregatorCore();
    // Insert in reversed price order; snapshot must sort ascending.
    agg.onTick(tick(1_000, 71_240.0, 0.1, 'buy'));
    agg.onTick(tick(1_500, 71_234.5, 0.1, 'buy'));
    agg.onTick(tick(2_000, 3_500.0, 1.0, 'buy', 'ETHUSDT-PERP'));
    const snap = agg.snapshot();
    expect(snap.cellsOpen.map((c) => [c.symbol, c.priceBucket])).toEqual([
      ['BTCUSDT-PERP', 14_246],
      ['BTCUSDT-PERP', 14_248],
      ['ETHUSDT-PERP', 700],
    ]);
  });
});

describe('fixture conformance (shared oracle for Task 1.5 / Task 5.2)', () => {
  const fixturesDir = join(import.meta.dir, '..', '__fixtures__');
  const inputFiles = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.input.json'))
    .sort();

  test('at least one committed fixture exists', () => {
    expect(inputFiles.length).toBeGreaterThan(0);
  });

  for (const inputFile of inputFiles) {
    const base = inputFile.slice(0, -'.input.json'.length);
    test(`${base}: reference core reproduces the committed expected oracle`, () => {
      const input = JSON.parse(
        readFileSync(join(fixturesDir, inputFile), 'utf8'),
      ) as AggregatorInputFixture;
      const expected = JSON.parse(
        readFileSync(join(fixturesDir, `${base}.expected.json`), 'utf8'),
      ) as AggregatorExpectedFixture;
      const produced = replayFixture(input);
      expect(produced).toEqual(expected);
    });
  }
});
