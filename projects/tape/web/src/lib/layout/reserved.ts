/**
 * Reserved dimensions for live-data regions (CLS fix).
 *
 * The footprint demo connects its WebSocket AFTER first paint (deferred
 * behind `requestIdleCallback` per Task 5.4's TBT mitigation), so the
 * snapshot lands ~1 s into the session. Every region that POPULATES from
 * that late snapshot — the status-bar value cells, the tape header count,
 * etc. — would grow its box when "0" becomes "1,234,567" or "—" becomes
 * "123 ms", shifting its neighbours. That post-paint box growth is
 * Cumulative Layout Shift.
 *
 * The fix is to reserve each region's FINAL box BEFORE data arrives, so
 * painting values into it causes zero layout shift. These constants are
 * the reserved minimum inline sizes (`min-width`) for each live numeric
 * cell, expressed in `ch` so they track the monospace digit advance
 * regardless of font-size, plus the `tabular-nums` enforcement that keeps
 * individual digit-width changes from reflowing within a cell.
 *
 * Sizing rationale — each value is the widest realistic content for that
 * cell at the JetBrains-Mono `ch` advance, rounded up so the value never
 * touches the reserved edge:
 *
 *   - `apiLatency`   "1234 ms"      ~7 ch  -> 7ch   (HTTP probe round-trip)
 *   - `wsState`      "reconnecting" 12 ch  -> 12ch  (longest WS label)
 *   - `tickCount`    "9,999,999"     9 ch  -> 10ch  (grouped tick total)
 *   - `lastTick`     "0.0 s"/"stale" 5 ch  -> 6ch   (freshness readout)
 *
 * The values are exported as a typed map so the reserved-dimension
 * contract is unit-testable (a regression that drops a cell or shrinks a
 * reservation below its content is caught by `reserved.test.ts`) and so
 * the Tailwind `min-w-[…ch]` arbitrary values have a single documented
 * source of truth.
 */

/** Reserved minimum inline-size, in `ch`, for each live status-bar cell. */
export const RESERVED_CH = {
  /** API latency value cell — "1234 ms". */
  apiLatency: 7,
  /** WS connection-state label — widest is "reconnecting" (12 chars). */
  wsState: 12,
  /** Tick-count value cell — grouped up to "9,999,999". */
  tickCount: 10,
  /** Last-tick freshness cell — "0.0 s" / "stale". */
  lastTick: 6,
} as const;

export type ReservedRegion = keyof typeof RESERVED_CH;

/**
 * Tailwind `min-w-[…ch]` class for a reserved region. Returns a STATIC
 * string per region (no runtime interpolation into the class) so the
 * Tailwind JIT can see every class at build time — the lookup table holds
 * the literal classes.
 */
const RESERVED_MIN_W_CLASS: Record<ReservedRegion, string> = {
  apiLatency: 'min-w-[7ch]',
  wsState: 'min-w-[12ch]',
  tickCount: 'min-w-[10ch]',
  lastTick: 'min-w-[6ch]',
};

export function reservedMinWidth(region: ReservedRegion): string {
  return RESERVED_MIN_W_CLASS[region];
}
