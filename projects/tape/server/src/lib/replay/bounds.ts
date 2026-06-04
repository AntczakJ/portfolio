/**
 * Replay input validation + UTC day-bounds math — Task 1.7.
 *
 * Pure, DB-free, deterministic. Lives apart from the route handler so the
 * fail-closed validation (symbol allowlist + strict `YYYY-MM-DD` UTC date)
 * and the `[dayStartMs, dayEndMs)` epoch-ms computation are unit-tested in
 * isolation from Postgres — month/year boundaries, leap years, malformed
 * inputs — per the Task 1.7 gate.
 *
 * **Fail-closed contract.** Both validators reject by default. A symbol
 * not on the allowlist or a date that is not a real calendar day in
 * strict `YYYY-MM-DD` form yields a structured error, which the route
 * turns into a 400. There is no "best-effort parse" path — a malformed
 * `:date` like `2026-13-40` or `2026-2-3` (non-zero-padded) or `2026-02-30`
 * (not a real day) is rejected, never silently coerced.
 */

/**
 * Known-symbol allowlist for v1. BTC-PERP only (PLAN.md "Out of scope
 * (v1)" defers ETH-PERP / SOL-PERP). The server pins `BTCUSDT-PERP` as
 * the single symbol (`src/server.ts` `V1_SYMBOL`); replay accepts both
 * the canonical exchange-qualified form and the short brand form so a
 * client URL using either resolves to the same persisted-row symbol.
 *
 * The VALUE each accepted alias maps to is the persisted
 * `footprint_cells.symbol` / `ticks.symbol` string the replay query
 * filters on — `BTCUSDT-PERP`, matching `V1_SYMBOL`. v2 multi-symbol
 * turns this map into a generated lookup; v1 hard-codes the single pair.
 */
const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  'BTCUSDT-PERP': 'BTCUSDT-PERP',
  'BTC-PERP': 'BTCUSDT-PERP',
};

/** The canonical persisted symbol the replay query filters on in v1. */
export const REPLAY_V1_SYMBOL = 'BTCUSDT-PERP';

/** Milliseconds in one UTC day (BTC is 24/7 — no exchange-calendar gap). */
export const DAY_MS = 86_400_000;

export interface ReplayBounds {
  /** The canonical persisted symbol to filter on. */
  readonly symbol: string;
  /** The validated, re-normalised `YYYY-MM-DD` day string (UTC). */
  readonly date: string;
  /** Inclusive lower bound: 00:00:00.000 UTC of the day, ms since epoch. */
  readonly dayStartMs: number;
  /** Exclusive upper bound: 00:00:00.000 UTC of the NEXT day, ms. */
  readonly dayEndMs: number;
}

export type ReplayBoundsError =
  | { readonly ok: false; readonly field: 'symbol'; readonly message: string }
  | { readonly ok: false; readonly field: 'date'; readonly message: string };

export type ReplayBoundsResult =
  | { readonly ok: true; readonly bounds: ReplayBounds }
  | ReplayBoundsError;

/**
 * Resolve a raw `:symbol` path param to its canonical persisted symbol,
 * or `null` if it is not on the v1 allowlist. Case-insensitive on the
 * alias key so a lowercase URL (`btc-perp`) still resolves — the URL is
 * user-facing, the persisted value is canonical.
 */
export function resolveSymbol(rawSymbol: string): string | null {
  const upper = rawSymbol.toUpperCase();
  return SYMBOL_ALIASES[upper] ?? null;
}

/**
 * Strict `YYYY-MM-DD` matcher. Requires exactly four digits, a literal
 * dash, exactly two digits, a dash, exactly two digits. Non-zero-padded
 * months/days (`2026-2-3`) and any extra characters are rejected by the
 * anchors. The regex is necessary but NOT sufficient — `2026-02-30`
 * matches the shape but is not a real day, so the caller round-trips
 * through `Date.UTC` and compares back (see `computeReplayBounds`).
 */
const STRICT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate `rawSymbol` + `rawDate` and compute the `[dayStartMs,
 * dayEndMs)` UTC epoch-ms bounds for the day. Fail-closed — returns a
 * typed error for an off-allowlist symbol or a malformed / non-real date.
 *
 * The bounds are a half-open interval `[dayStartMs, dayEndMs)` so the
 * replay query uses `bucket_ts >= dayStartMs AND bucket_ts < dayEndMs`:
 * the last bar of the day (`23:59:00.000 UTC`) is included, and the first
 * bar of the next day (`00:00:00.000 UTC`) is excluded with no off-by-one
 * overlap between consecutive days.
 */
export function computeReplayBounds(
  rawSymbol: string,
  rawDate: string,
): ReplayBoundsResult {
  const symbol = resolveSymbol(rawSymbol);
  if (symbol === null) {
    return {
      ok: false,
      field: 'symbol',
      message: `Unknown symbol '${rawSymbol}'. v1 supports BTC-PERP (BTCUSDT-PERP) only.`,
    };
  }

  const match = STRICT_DATE_RE.exec(rawDate);
  if (match === null) {
    return {
      ok: false,
      field: 'date',
      message: `Malformed date '${rawDate}'. Expected strict UTC 'YYYY-MM-DD'.`,
    };
  }

  // Non-null per the regex's three capture groups.
  const year = Number(match[1]);
  const month = Number(match[2]); // 1-12 as written
  const day = Number(match[3]); // 1-31 as written

  // `Date.UTC` is lenient — it rolls `2026-02-30` over to 2026-03-02.
  // To reject non-real days we round-trip: build the timestamp, then
  // read the UTC year/month/day back and require they equal the input.
  // A rolled-over date fails the equality, so `2026-02-30`, `2026-13-01`,
  // `2026-00-10` etc. are all rejected fail-closed.
  const dayStartMs = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(dayStartMs);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return {
      ok: false,
      field: 'date',
      message: `Date '${rawDate}' is not a real calendar day (UTC).`,
    };
  }

  return {
    ok: true,
    bounds: {
      symbol,
      date: rawDate,
      dayStartMs,
      dayEndMs: dayStartMs + DAY_MS,
    },
  };
}

/**
 * Clamp + validate a raw `?from=` / `?to=` query pair for the tick-tail
 * window against the day bounds. Both are optional ms-epoch integers;
 * defaults are the full-day bounds. The window is intersected with
 * `[dayStartMs, dayEndMs)` so a client cannot scan outside the requested
 * day's partition (keeps the partition-pruned `ticks` scan bounded and
 * fail-closed against a `from` of 0 or a `to` past the day).
 *
 * Returns `null` for a malformed (non-integer / negative / inverted)
 * window — the route turns that into a 400. An empty-but-valid window
 * (from === to) is allowed and streams zero rows.
 */
export interface TickWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

export function computeTickWindow(
  bounds: ReplayBounds,
  rawFrom: string | undefined,
  rawTo: string | undefined,
): TickWindow | null {
  const fromMs = rawFrom === undefined ? bounds.dayStartMs : Number(rawFrom);
  const toMs = rawTo === undefined ? bounds.dayEndMs : Number(rawTo);

  if (
    !Number.isInteger(fromMs) ||
    !Number.isInteger(toMs) ||
    fromMs < 0 ||
    toMs < 0 ||
    fromMs > toMs
  ) {
    return null;
  }

  // Intersect with the day bounds — clamp, never widen.
  const clampedFrom = Math.max(fromMs, bounds.dayStartMs);
  const clampedTo = Math.min(toMs, bounds.dayEndMs);

  // If the requested window does not overlap the day at all, collapse to
  // an empty window at the lower clamp so the query streams zero rows.
  if (clampedFrom >= clampedTo) {
    return { fromMs: clampedFrom, toMs: clampedFrom };
  }

  return { fromMs: clampedFrom, toMs: clampedTo };
}
