//! Bucketing constants and pure helpers — Task 1.5.
//!
//! These live here (not in `bridge::messages`) because the bucket sizes
//! are **policy**, not **schema**. The wire shape (a `bucket_ts: i64`
//! and a `price_bucket: i64`) does not care what the bucket interval
//! is; the renderer and the aggregator do. Co-locating the constants
//! with the aggregator that uses them keeps schema evolution
//! (`messages.rs`) orthogonal to policy evolution (this file).
//!
//! Per PLAN.md § "Wow moment":
//!   - 1-minute time buckets, $5 price buckets on BTC-PERP.
//!
//! If a v2 multi-symbol expansion lands, replace the constants with a
//! per-symbol lookup (e.g. `bucket_size_for_symbol("ETH-PERP") = 0.5`).
//! The lookup stays in this module; the aggregator continues to call
//! the helpers without knowing about the new dimension.

/// Width of one time bucket (one footprint bar) in milliseconds.
/// PLAN.md pins 1 minute on BTC-PERP.
pub const TIME_BUCKET_MS: i64 = 60_000;

/// Width of one price bucket on BTC-PERP, in USD. PLAN.md § "Wow moment".
pub const PRICE_BUCKET_USD: f64 = 5.0;

/// Floor `ts_ms` to the start of its time bucket.
///
/// Pure function — no allocation, no I/O. Bench-friendly and trivially
/// testable.
#[inline]
#[must_use]
pub fn time_bucket(ts_ms: i64) -> i64 {
    if ts_ms >= 0 {
        (ts_ms / TIME_BUCKET_MS) * TIME_BUCKET_MS
    } else {
        // For ts < 0 (defensive — never expected on a real tick) we
        // floor toward negative infinity, matching JS Math.floor on the
        // TS side. ts_ms in this codebase is always a positive epoch
        // millisecond; the branch exists so a logic bug never trips a
        // signed-truncation surprise.
        ((ts_ms - TIME_BUCKET_MS + 1) / TIME_BUCKET_MS) * TIME_BUCKET_MS
    }
}

/// Floor `price` to its price-bucket index.
///
/// Returns `i64` because price buckets are dense integer ids in the
/// rendered chart (the X-axis is a bar index, the Y-axis is a price
/// bucket index). Multiply by `PRICE_BUCKET_USD` to recover the
/// lower-bound price of the bucket.
///
/// `f64::floor` is the canonical "floor toward negative infinity"
/// operation; `as i64` truncates toward zero, which would round the
/// wrong way for negative prices. BTC-PERP is never negative — but
/// EUR/USD differentials can be in v2, so we floor explicitly.
#[inline]
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn price_bucket(price: f64) -> i64 {
    (price / PRICE_BUCKET_USD).floor() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_bucket_floors_to_minute() {
        assert_eq!(time_bucket(0), 0);
        assert_eq!(time_bucket(59_999), 0);
        assert_eq!(time_bucket(60_000), 60_000);
        assert_eq!(time_bucket(60_001), 60_000);
        // 2026-05-30T12:34:56.789Z = 1_780_958_096_789 ms
        let ts: i64 = 1_780_958_096_789;
        let bucket = time_bucket(ts);
        assert_eq!(bucket % TIME_BUCKET_MS, 0);
        assert!(ts - bucket < TIME_BUCKET_MS);
    }

    #[test]
    fn price_bucket_floors_to_5_usd() {
        assert_eq!(price_bucket(0.0), 0);
        assert_eq!(price_bucket(4.99), 0);
        assert_eq!(price_bucket(5.0), 1);
        assert_eq!(price_bucket(7.5), 1);
        assert_eq!(price_bucket(10.0), 2);
        assert_eq!(price_bucket(71_234.5), 14_246);
        assert_eq!(price_bucket(71_235.0), 14_247);
    }
}
