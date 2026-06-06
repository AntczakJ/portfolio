/**
 * Seeded PRNG carried in WorldState (ADR-002 B1).
 *
 * A small deterministic mulberry32 generator drives the bounded per-tick jitter
 * (speed-modulation noise) that makes the fleet read as alive without breaking
 * reproducibility. The faker baseline (fleet, route assignment, base speeds,
 * dwell durations) is built ONCE off the hot path and frozen; THIS PRNG is the
 * only randomness inside the pure tick reducer, and its state is part of
 * WorldState — so folding the reducer from the baseline to tick N reconstructs
 * the exact same stream (the seek/replay guarantee).
 *
 * The generator is expressed as a PURE step: `nextRandom(state) -> { state,
 * value }`. No mutable closure escapes into the reducer; the reducer threads the
 * returned state forward, identically on a live run and on a replay fold.
 */

/** The PRNG state — a single 32-bit unsigned integer. */
export interface PrngState {
  /** Internal accumulator (uint32). */
  readonly a: number;
}

/** Build a fresh PRNG state from an integer seed. */
export function createPrng(seed: number): PrngState {
  return { a: seed >>> 0 };
}

/**
 * One mulberry32 step. Returns the next state and a float in [0, 1). Pure: the
 * caller stores the new state back into WorldState.
 */
export function nextRandom(state: PrngState): { state: PrngState; value: number } {
  const a = (state.a + 0x6d2b79f5) | 0;
  const nextState: PrngState = { a: a >>> 0 };
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: nextState, value };
}

/**
 * Draw a float in `[min, max)` from the PRNG, returning the advanced state.
 * Pure (built on {@link nextRandom}).
 */
export function nextRange(
  state: PrngState,
  min: number,
  max: number,
): { state: PrngState; value: number } {
  const { state: nextState, value } = nextRandom(state);
  return { state: nextState, value: min + value * (max - min) };
}
