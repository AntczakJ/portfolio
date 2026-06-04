/**
 * Footprint-cell aggregator — public barrel.
 *
 * Task 1.4: the TypeScript REFERENCE implementation that Task 1.5 ports
 * to Rust and Task 5.2 checks for byte-identical output. Consumers reach
 * for this barrel rather than the per-file paths.
 *
 *   - `AggregatorCore`        — the pure state machine (no IO).
 *   - `WsAggregatorAdapter`   — the thin WS / snapshot-cache seam.
 *   - bucketing constants + pure helpers (`TIME_BUCKET_MS`,
 *     `PRICE_BUCKET_USD`, `timeBucket`, `priceBucket`).
 *   - the I/O types (`AggregatorTick`, `CellDelta`, `CellClose`,
 *     `OutboundFrame`, `AggregatorSnapshot`, `CvdRollup`, `Aggressor`).
 */

export { AggregatorCore } from './core';
export {
  WsAggregatorAdapter,
  type WsAggregatorAdapterOptions,
} from './adapter';
export {
  PRICE_BUCKET_USD,
  TIME_BUCKET_MS,
  priceBucket,
  timeBucket,
} from './bucketing';
export type {
  Aggressor,
  AggregatorSnapshot,
  AggregatorTick,
  CellClose,
  CellDelta,
  CvdRollup,
  OutboundFrame,
} from './types';
export {
  replayFixture,
  type AggregatorExpectedFixture,
  type AggregatorInputFixture,
} from './replay';
