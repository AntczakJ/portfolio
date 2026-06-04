/**
 * Bucketing constants and pure helpers — Task 1.4 (TypeScript reference
 * implementation of the footprint-cell aggregator).
 *
 * This file is the TS MIRROR of the Rust worker's
 * `projects/tape/worker/src/bucketing.rs`. The two must stay
 * byte-for-byte equivalent in output because the conformance test
 * (Task 5.2) asserts the Rust port matches this reference on a recorded
 * tick dataset. Every change here MUST be mirrored in `bucketing.rs`
 * and vice versa — they are one logical module split across two
 * languages.
 *
 * **Why these constants live here, not in the WS / DB schema modules.**
 * The bucket sizes are POLICY, not SCHEMA. The wire shape (a
 * `bucketTs: number` and a `priceBucket: number`) does not care what
 * the bucket interval is; the renderer and the aggregator do. Keeping
 * the constants next to the aggregator that consumes them keeps schema
 * evolution orthogonal to policy evolution — identical reasoning to the
 * Rust side's module note.
 *
 * **v1 parameters (per PLAN.md § "Wow moment"):**
 *   - 1-minute time buckets (`TIME_BUCKET_MS = 60_000`).
 *   - $5 price buckets on BTC-PERP (`PRICE_BUCKET_USD = 5`).
 *
 * These are the values the existing Rust worker already commits to
 * (`worker/src/bucketing.rs`), the synthesizer already commits to
 * (`lib/ws/synthesizer.ts` — `SYNTH_PRICE_BUCKET_WIDTH = 5`, 60_000 ms
 * buckets), and the ingest snapshot-cache path already commits to
 * (`binance-ingestor.ts` — `event.T - (event.T % 60_000)`). This module
 * does NOT invent a new magic number; it names and documents the value
 * the rest of the codebase already assumed implicitly. The bar-interval
 * / tick-size choice is flagged in AGENT_NOTES as a candidate for a
 * ratifying architect ADR (it is currently asserted in three places
 * with no single ADR owning it).
 *
 * **v2 multi-symbol note.** When ETH-PERP / SOL-PERP land in v2, replace
 * the flat `PRICE_BUCKET_USD` constant with a per-symbol lookup
 * (`priceBucketSizeFor('ETH-PERP') = 0.5`). The lookup stays in this
 * module; callers keep calling the pure helpers without knowing about
 * the new dimension. Same migration path the Rust side documents.
 */

/**
 * Width of one time bucket (one footprint bar) in milliseconds.
 * PLAN.md pins 1 minute on BTC-PERP.
 */
export const TIME_BUCKET_MS = 60_000;

/**
 * Width of one price bucket on BTC-PERP, in USD. PLAN.md § "Wow moment".
 */
export const PRICE_BUCKET_USD = 5;

/**
 * Floor `tsMs` to the start of its time bucket.
 *
 * Pure function — no allocation, no I/O, no clock read. The input is a
 * tick timestamp; bar close is driven by tick timestamps crossing a
 * boundary, never by wall-clock, so replaying the same ticks always
 * yields identical buckets.
 *
 * For `tsMs >= 0` this is `floor(tsMs / TIME_BUCKET_MS) * TIME_BUCKET_MS`.
 * For `tsMs < 0` (defensive — never expected on a real epoch-ms tick) we
 * floor toward negative infinity to match the Rust side's signed-division
 * branch and JS `Math.floor` semantics. Real ticks in this codebase are
 * always positive epoch milliseconds; the branch exists so a logic bug
 * upstream never trips a truncation surprise that would diverge from the
 * Rust port.
 */
export function timeBucket(tsMs: number): number {
  return Math.floor(tsMs / TIME_BUCKET_MS) * TIME_BUCKET_MS;
}

/**
 * Floor `price` to its price-bucket INDEX.
 *
 * Returns a dense integer id (NOT a USD price). The rendered chart's
 * Y-axis is a price-bucket index; multiply by `PRICE_BUCKET_USD` to
 * recover the lower-bound price of the bucket. This INDEX convention is
 * the one the Rust worker (`price_bucket()` returns `i64`), the
 * synthesizer (`#pickPriceBucket` returns `floor(price / 5)`), and the
 * renderer's `priceToY` math all share. Emitting a USD-floored price
 * here instead would put every cell tens of thousands of pixels
 * off-viewport — a bug the synthesizer module documents having already
 * hit and fixed.
 *
 * `Math.floor` is "floor toward negative infinity"; BTC-PERP price is
 * never negative, but flooring explicitly keeps parity with the Rust
 * `f64::floor` (rather than `as i64` truncation toward zero) so a future
 * negative-price instrument in v2 buckets identically on both sides.
 */
export function priceBucket(price: number): number {
  return Math.floor(price / PRICE_BUCKET_USD);
}
