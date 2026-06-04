/**
 * Fixture replay harness — Task 1.4.
 *
 * The canonical procedure for turning an aggregator INPUT fixture into
 * its EXPECTED output by driving the reference `AggregatorCore`. Lives
 * in the aggregator module (not in `scripts/`) so both the fixture
 * generator (`scripts/gen-aggregator-fixtures.ts`) and the unit suite
 * (`__tests__/core.test.ts`) import the SAME replay logic — and so it
 * stays inside the server `rootDir`.
 *
 * The Rust port (Task 1.5) and the conformance test (Task 5.2) mirror
 * this exact procedure against their own aggregator: feed all ticks,
 * run `closeExpired` once per `closeAt` entry in order, then `drainAll`,
 * then read the snapshot + counters. Any divergence in the procedure
 * (e.g. draining before the timed closes) would change the output —
 * keep the two languages' harnesses in lockstep.
 */

import { AggregatorCore } from './core';
import type {
  AggregatorSnapshot,
  AggregatorTick,
  CellClose,
  CellDelta,
  CvdRollup,
} from './types';

/** An aggregator input fixture (`<name>.input.json`). */
export interface AggregatorInputFixture {
  readonly description: string;
  readonly ticks: readonly AggregatorTick[];
  /** Ordered `nowMs` values to drive `closeExpired` after all ticks. */
  readonly closeAt: readonly number[];
}

/** The derived expected oracle (`<name>.expected.json`). */
export interface AggregatorExpectedFixture {
  readonly deltas: CellDelta[];
  readonly closes: CellClose[];
  readonly cvd: CvdRollup[];
  readonly finalSnapshot: AggregatorSnapshot;
  readonly counters: {
    readonly outOfOrderTicks: number;
    readonly duplicateTicks: number;
    readonly sessionExtreme: Record<string, number>;
  };
}

/**
 * Replay one input fixture through a fresh core and collect the
 * complete output oracle. Pure and deterministic.
 */
export function replayFixture(
  input: AggregatorInputFixture,
): AggregatorExpectedFixture {
  const core = new AggregatorCore();
  const deltas: CellDelta[] = [];
  const closes: CellClose[] = [];
  const cvd: CvdRollup[] = [];
  const symbols = new Set<string>();

  for (const tick of input.ticks) {
    symbols.add(tick.symbol);
    for (const frame of core.onTick(tick)) {
      if (frame.kind === 'cell.delta') deltas.push(frame.payload);
    }
  }

  for (const nowMs of input.closeAt) {
    const { frames, cvd: rollups } = core.closeExpired(nowMs);
    for (const frame of frames) {
      if (frame.kind === 'cell.close') closes.push(frame.payload);
    }
    cvd.push(...rollups);
  }

  const drained = core.drainAll();
  for (const frame of drained.frames) {
    if (frame.kind === 'cell.close') closes.push(frame.payload);
  }
  cvd.push(...drained.cvd);

  const sessionExtreme: Record<string, number> = {};
  for (const symbol of [...symbols].sort()) {
    sessionExtreme[symbol] = core.sessionExtreme(symbol);
  }

  return {
    deltas,
    closes,
    cvd,
    finalSnapshot: core.snapshot(),
    counters: {
      outOfOrderTicks: core.outOfOrderTicks,
      duplicateTicks: core.duplicateTicks,
      sessionExtreme,
    },
  };
}
