/**
 * Deterministic footprint snapshot for the injected-path E2E (Task 5.3).
 *
 * Shape mirrors `WSSnapshotPayload` (server
 * `src/lib/schemas/ws/snapshot.ts`): a `symbol`, the open `currentBarTs`,
 * an array of CLOSED cells (absolute totals), the open-bar `cellsOpen`
 * deltas, and `recentTicks`. We build it by hand rather than importing
 * `tape-server` so the harness has zero dependency on the server package
 * resolving from the e2e workspace — the only contract that matters here
 * is "the same field names the store's `ingestSnapshot` reads".
 *
 * Determinism: a fixed `BASE_TS` (a real UTC minute boundary) +
 * arithmetic price/volume ramps. No `Date.now()`, no faker — the same
 * bytes every run so the canvas paints the same cells and the assertions
 * are stable. The volumes are chosen so the bid/ask split and per-bar
 * delta are visibly non-trivial (some bars net-buy, some net-sell) — the
 * chart actually has data to draw, which is the point of the test.
 *
 * Scale: 12 closed bars × ~12 price levels = ~144 closed cells. That is
 * comfortably above the "sparse right-edge sliver" failure mode the
 * Phase 4.1 critique flagged, so the painted region is unambiguous.
 */

export interface SnapshotCell {
  symbol: string;
  bucketTs: number;
  priceBucket: number;
  bidVolume: number;
  askVolume: number;
  trades: number;
}

export interface SnapshotOpenCell {
  tsMs: number;
  bucketTs: number;
  priceBucket: number;
  bidVolumeDelta: number;
  askVolumeDelta: number;
  tradesDelta: number;
}

export interface SnapshotTick {
  tsMs: number;
  price: number;
  qty: number;
  aggressor: 'buy' | 'sell';
}

export interface FootprintSnapshot {
  symbol: string;
  currentBarTs: number;
  cells: SnapshotCell[];
  cellsOpen: SnapshotOpenCell[];
  recentTicks: SnapshotTick[];
}

const SYMBOL = 'BTCUSDT-PERP';
/** 2024-06-03T00:00:00.000Z — a real UTC minute boundary. */
const BASE_TS = 1_717_372_800_000;
const BAR_MS = 60_000;
const PRICE_BUCKET_USD = 5;
const BARS = 12;
const LEVELS_PER_BAR = 12;
/** Mid price the bars cluster around (a plausible BTC-PERP level). */
const MID_PRICE = 71_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildFootprintSnapshot(): FootprintSnapshot {
  const cells: SnapshotCell[] = [];

  for (let bar = 0; bar < BARS; bar += 1) {
    const bucketTs = BASE_TS + bar * BAR_MS;
    // Alternate the net flow per bar so the footprint + CVD line have
    // both rising and falling segments — a static all-buy ramp would
    // not exercise the delta colouring.
    const netBuyBar = bar % 2 === 0;
    for (let level = 0; level < LEVELS_PER_BAR; level += 1) {
      const priceBucket = MID_PRICE - (LEVELS_PER_BAR / 2) * PRICE_BUCKET_USD +
        level * PRICE_BUCKET_USD;
      // Volume profile peaks in the middle of the bar (a believable
      // footprint silhouette) so cells differ in magnitude.
      const distanceFromMid = Math.abs(level - LEVELS_PER_BAR / 2);
      const base = 14 - distanceFromMid * 1.1;
      const bidVolume = round2(Math.max(0.2, base * (netBuyBar ? 0.8 : 1.2)));
      const askVolume = round2(Math.max(0.2, base * (netBuyBar ? 1.25 : 0.75)));
      cells.push({
        symbol: SYMBOL,
        bucketTs,
        priceBucket,
        bidVolume,
        askVolume,
        trades: 6 + level + bar,
      });
    }
  }

  const currentBarTs = BASE_TS + BARS * BAR_MS;
  const cellsOpen: SnapshotOpenCell[] = [];
  for (let level = 0; level < LEVELS_PER_BAR; level += 1) {
    const priceBucket = MID_PRICE - (LEVELS_PER_BAR / 2) * PRICE_BUCKET_USD +
      level * PRICE_BUCKET_USD;
    cellsOpen.push({
      tsMs: currentBarTs + 250 + level,
      bucketTs: currentBarTs,
      priceBucket,
      bidVolumeDelta: round2(0.3 + level * 0.05),
      askVolumeDelta: round2(0.4 + level * 0.05),
      tradesDelta: 2 + (level % 3),
    });
  }

  const recentTicks: SnapshotTick[] = [];
  for (let i = 0; i < 40; i += 1) {
    recentTicks.push({
      tsMs: currentBarTs + 300 + i * 5,
      price: round2(MID_PRICE - 30 + (i % 12) * PRICE_BUCKET_USD),
      qty: round2(0.05 + (i % 7) * 0.03),
      aggressor: i % 2 === 0 ? 'buy' : 'sell',
    });
  }

  return { symbol: SYMBOL, currentBarTs, cells, cellsOpen, recentTicks };
}

/** Total closed-cell count the snapshot paints — used by an assertion. */
export const SNAPSHOT_CLOSED_CELL_COUNT = BARS * LEVELS_PER_BAR;
/** Tick count seeded into the tape strip. */
export const SNAPSHOT_TICK_COUNT = 40;
