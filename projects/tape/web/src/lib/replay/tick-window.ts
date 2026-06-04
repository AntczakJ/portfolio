/**
 * Tick-window fetch math for replay mode (Task 3.6).
 *
 * The tape strip in replay does NOT re-download the day's ticks. Instead
 * it fetches a bounded window around the replay cursor from the sibling
 * endpoint `GET /api/replay/:symbol/:date/ticks?from=&to=` (ADR-005,
 * Task 1.7). This module owns the pure math that turns a cursor position
 * into the `[from, to]` epoch-ms window, plus the day's absolute epoch
 * origin so the cursor (which is ms-from-session-open) maps to absolute
 * Binance trade timestamps.
 *
 * **Cursor model.** The replay scrub position (`replayPositionMs` in
 * `useUiStore`) is ms from 00:00 UTC of the session day — `[0,
 * REPLAY_DAY_MS]`. The persisted ticks carry absolute epoch-ms
 * (`ts_ms`). So `absoluteCursorMs = dayStartMs + cursorMs`, where
 * `dayStartMs` is the UTC midnight epoch of the selected date.
 *
 * **Window shape.** We fetch the trailing `TICK_WINDOW_MS` of ticks
 * BEFORE the cursor — the tape shows what just printed, the same as live
 * mode where the strip shows the most recent trades. So `to =
 * absoluteCursorMs` and `from = absoluteCursorMs - TICK_WINDOW_MS`,
 * clamped to the day bounds (the server also clamps, but clamping client
 * side avoids a pointless request for a negative `from`).
 */

/** UTC midnight epoch-ms for a `YYYY-MM-DD` date string. */
export function dayStartMs(date: string): number {
  // `Date.parse('YYYY-MM-DD')` is spec'd to interpret a bare date as
  // UTC midnight — exactly the session-day origin we want.
  return Date.parse(`${date}T00:00:00.000Z`);
}

/**
 * Trailing tick window length in ms. 90 s covers roughly 1.5 bars of
 * recent trades — enough to fill the tape strip's visible rows on a tall
 * desktop viewport (the live snapshot pins 200 ticks) without pulling a
 * large slice on every scrub. Tuned for the tape's "what just printed"
 * mental model, not for a full-history scroll-back.
 */
export const TICK_WINDOW_MS = 90_000;

/** One absolute epoch-ms `[from, to]` window for the ticks endpoint. */
export interface TickWindow {
  from: number;
  to: number;
}

/**
 * Compute the absolute `[from, to]` tick window for a replay cursor.
 *
 * @param dayStart   UTC-midnight epoch-ms of the session day.
 * @param cursorMs   Cursor position, ms from session open `[0, dayLenMs]`.
 * @param dayLenMs   Length of the session day in ms (REPLAY_DAY_MS).
 * @param windowMs   Trailing window length (defaults to TICK_WINDOW_MS).
 *
 * The window is clamped so `from` never precedes the day's start and
 * `to` never exceeds the day's end. `from <= to` always holds.
 */
export function computeTickWindow(
  dayStart: number,
  cursorMs: number,
  dayLenMs: number,
  windowMs: number = TICK_WINDOW_MS,
): TickWindow {
  const clampedCursor = Math.max(0, Math.min(dayLenMs, cursorMs));
  const dayEnd = dayStart + dayLenMs;
  const to = Math.min(dayEnd, dayStart + clampedCursor);
  const from = Math.max(dayStart, to - windowMs);
  return { from, to };
}
