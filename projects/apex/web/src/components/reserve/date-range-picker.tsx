'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';
import {
  BOOKABLE_WINDOW_DAYS,
  MAX_RENTAL_DAYS,
  MIN_RENTAL_DAYS,
  addDays,
  diffDays,
  fromDateIso,
  getNowDateIso,
} from '@/lib/clock';
import type { DateRange, DisabledRange } from '@/lib/schemas/availability';

/**
 * Accessible keyboard-operable date-range picker (Task 5.5 / ADR-003).
 *
 * A hand-rolled month grid over the frozen 60-day bookable window. NO library —
 * the range logic is half-open `[from, to)` over the frozen clock, which is
 * simple and deterministic. The picker is a proper keyboard widget:
 *
 *   - The grid is a `role="grid"`; each focusable day BUTTON is wrapped in a
 *     `role="gridcell"` (the WAI-ARIA grid pattern — A-04 / P2-4).
 *   - Arrow keys move a roving focus (Left/Right ±1 day, Up/Down ±7 days),
 *     Home/End jump to the week edges, PageUp/PageDown change month.
 *     Only ONE day is in the tab order (`tabIndex=0`); the rest are `-1`
 *     (the standard grid roving-tabindex pattern), so Tab enters/leaves the
 *     grid as a single stop.
 *   - Enter/Space selects: first press sets the start, second sets the end
 *     (a half-open range; the picked `to` is the day AFTER the last night, so a
 *     1-day rental is from=D, to=D+1). A third press starts over.
 *   - Disabled days (past, beyond the window, or booked) are
 *     `aria-disabled` + `disabled` and announced via the legend; they cannot be
 *     focused or chosen.
 *   - A hover / keyboard-focus PREVIEW band lights the in-progress range between
 *     the pending pick-up and the hovered (or focused) day (A-15), so the user
 *     sees the candidate range before committing it.
 *   - The `aria-live` status line announces the current selection / day count
 *     AND — crucially (A-06) — a SPECIFIC reason whenever a chosen range is
 *     REJECTED (crosses a booked day / too short / too long / past the window),
 *     so both sighted and screen-reader users learn why the range did not take,
 *     never a silent restart.
 *
 * On desktop (lg+) TWO months are shown side-by-side (A-07) so a 60-day window
 * reads at a glance; mobile keeps one month with the forward chevron.
 *
 * Determinism: the grid, "today", and the window all read the frozen clock, so
 * the picker renders byte-identically across reloads + screenshots.
 */

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

interface DateRangePickerProps {
  vehicleId: string | undefined;
  /** Booked/blackout ranges (half-open) to disable. */
  disabledRanges: readonly DisabledRange[];
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}

/** ISO weekday index Mon=0 … Sun=6 for a `YYYY-MM-DD` date. */
function isoWeekdayIndex(dateIso: string): number {
  const dow = fromDateIso(dateIso).getUTCDay(); // Sun=0
  return (dow + 6) % 7; // Mon=0
}

/** The first day of the month containing `dateIso`, as `YYYY-MM-01`. */
function monthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/** Add `months` whole calendar months to a `YYYY-MM-01` date. */
function addMonths(monthStartIso: string, months: number): string {
  const d = fromDateIso(monthStartIso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return `${d.toISOString().slice(0, 7)}-01`;
}

/** Number of days in the calendar month of `monthStartIso`. */
function daysInMonth(monthStartIso: string): number {
  const d = fromDateIso(monthStartIso);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/** The human month label, e.g. "July 2026". */
function monthLabelOf(monthStartIso: string): string {
  return `${MONTH_NAMES[Number(monthStartIso.slice(5, 7)) - 1] ?? ''} ${monthStartIso.slice(0, 4)}`;
}

/** A specific, user-facing reason a chosen range was rejected (A-06). */
export type RangeRejection =
  | 'conflict'
  | 'too-short'
  | 'too-long'
  | 'after-window';

/**
 * Pure validation of a candidate half-open range against the booking window +
 * rules. Returns `null` when the range is acceptable, or a SPECIFIC reason so
 * the picker can explain the rejection rather than silently restarting (A-06).
 * Extracted so it is unit-testable in isolation (Phase 7 owns the exhaustive
 * matrix; a sanity test lives alongside the picker).
 */
export function validateCandidateRange(params: {
  startDay: string;
  to: string;
  windowEnd: string;
  bookedDays: ReadonlySet<string>;
}): RangeRejection | null {
  const { startDay, to, windowEnd, bookedDays } = params;
  // Crosses a booked day?
  let d = startDay;
  while (d < to) {
    if (bookedDays.has(d)) return 'conflict';
    d = addDays(d, 1);
  }
  const days = diffDays(startDay, to);
  if (days < MIN_RENTAL_DAYS) return 'too-short';
  if (days > MAX_RENTAL_DAYS) return 'too-long';
  if (to > windowEnd) return 'after-window';
  return null;
}

/** The accessible explanatory message for a rejection (A-06 vocabulary). */
function rejectionMessage(reason: RangeRejection): string {
  switch (reason) {
    case 'conflict':
      return 'Those dates overlap a day that is already booked — restarting from your new pick-up day.';
    case 'too-short':
      return `The minimum rental is ${String(MIN_RENTAL_DAYS)} day — restarting from your new pick-up day.`;
    case 'too-long':
      return `The maximum rental is ${String(MAX_RENTAL_DAYS)} days — restarting from your new pick-up day.`;
    case 'after-window':
      return 'That return day is past the bookable window — restarting from your new pick-up day.';
  }
}

export function DateRangePicker({
  vehicleId,
  disabledRanges,
  value,
  onChange,
}: DateRangePickerProps): ReactNode {
  const statusId = useId();

  const today = getNowDateIso();
  const windowEnd = addDays(today, BOOKABLE_WINDOW_DAYS); // exclusive

  // The first of the two displayed months (mobile shows only this one).
  const [viewMonth, setViewMonth] = useState<string>(() => monthStart(today));
  // The roving-focus day.
  const [focusDay, setFocusDay] = useState<string>(value?.fromISODate ?? today);
  // The in-progress selection start (set on the first click, before the end).
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  // The day under hover / keyboard focus (drives the preview band — A-15).
  const [previewDay, setPreviewDay] = useState<string | null>(null);
  // A specific rejection reason set on a failed second pick (A-06). Cleared on
  // the next selection action.
  const [rejection, setRejection] = useState<RangeRejection | null>(null);
  // Bumped on each selection so the focus effect re-runs even when the focused
  // day is unchanged (a selection drops DOM focus to <body>, so we re-assert).
  const [focusTick, setFocusTick] = useState(0);

  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocusRef = useRef(false);

  // Keep the FIRST displayed month anchored on the focused day's month, so the
  // roving focus is always in a visible pane on BOTH layouts: mobile renders
  // only this month, and desktop renders this month + the next, so the focused
  // day is never in a hidden (display:none) second pane.
  useEffect(() => {
    const focusMonth = monthStart(focusDay);
    setViewMonth((prev) => (focusMonth === prev ? prev : focusMonth));
  }, [focusDay]);

  // Move actual DOM focus to the roving day after a keyboard move OR a selection
  // (`focusTick` bumps on select so this re-runs even when `focusDay` is
  // unchanged). A `useLayoutEffect` runs BEFORE paint and re-asserts focus
  // synchronously after EVERY render where the user was driving the grid, so a
  // re-render that drops DOM focus to <body> (a selection flips the cell's
  // className) is corrected within the same frame — no flicker, no lost
  // keyboard flow. `keyboardActiveRef` gates it so the grid never steals focus
  // when the user is elsewhere on the page.
  const keyboardActiveRef = useRef(false);
  useLayoutEffect(() => {
    if (shouldFocusRef.current) {
      shouldFocusRef.current = false;
      keyboardActiveRef.current = true;
    }
    if (!keyboardActiveRef.current) return;
    const active = document.activeElement;
    const grid = gridRef.current;
    if (!grid) return;
    // Only restore if focus has fallen out of the grid (to <body>) — never yank
    // focus away from a cell the user is already on.
    if (active && grid.contains(active)) return;
    grid
      .querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)
      ?.focus();
  }, [focusDay, viewMonth, focusTick, value, pendingStart]);

  // A set of disabled (booked) days for O(1) lookup. Each half-open range
  // `[from, to)` disables every day in `[from, to)`.
  const bookedDays = useMemo(() => {
    const set = new Set<string>();
    for (const r of disabledRanges) {
      let d = r.fromISODate;
      while (d < r.toISODate) {
        set.add(d);
        d = addDays(d, 1);
      }
    }
    return set;
  }, [disabledRanges]);

  function isPast(dateIso: string): boolean {
    return dateIso < today;
  }
  function isAfterWindow(dateIso: string): boolean {
    return dateIso >= windowEnd; // window end is exclusive
  }
  function isBooked(dateIso: string): boolean {
    return bookedDays.has(dateIso);
  }
  function isSelectableDay(dateIso: string): boolean {
    return !isPast(dateIso) && !isAfterWindow(dateIso) && !isBooked(dateIso);
  }

  // The committed selection's [from, to) for highlighting.
  const selFrom = value?.fromISODate ?? pendingStart ?? null;
  const selTo = value?.toISODate ?? null;

  function dayInSelection(dateIso: string): boolean {
    if (selFrom && selTo) return dateIso >= selFrom && dateIso < selTo;
    if (selFrom && !selTo) return dateIso === selFrom;
    return false;
  }

  // The hover/focus PREVIEW band (A-15): only while a start is pending and no
  // end is committed, light the candidate range between the start and the
  // hovered/focused day (exclusive of the endpoints, which get their own style).
  const previewFrom = !value && pendingStart && previewDay ? pendingStart : null;
  function dayInPreview(dateIso: string): boolean {
    if (!previewFrom || !previewDay) return false;
    const lo = previewFrom <= previewDay ? previewFrom : previewDay;
    const hi = previewFrom <= previewDay ? previewDay : previewFrom;
    return dateIso > lo && dateIso < hi;
  }

  function handleSelect(dateIso: string): void {
    setRejection(null);
    // Keep DOM focus on the picked cell after the re-render. A selection flips
    // the cell's className (-> selected) which, in this grid, drops focus to
    // <body>; routing the refocus through the roving-focus mechanism (set the
    // target + `shouldFocusRef` + bump `focusTick`, so the post-commit effect
    // re-runs even when the focused day is unchanged) keeps the keyboard flow.
    shouldFocusRef.current = true;
    setFocusDay(dateIso);
    setFocusTick((t) => t + 1);
    // Third click (a complete range exists) → start over from this day.
    if (value) {
      onChange(undefined);
      setPendingStart(dateIso);
      return;
    }
    if (pendingStart === null) {
      setPendingStart(dateIso);
      return;
    }
    // Second click — order the two days and commit a half-open range. The
    // picked end day is INCLUSIVE in the user's mind (the last rental night),
    // so `to` = endDay + 1 (the half-open exclusive bound).
    const a = pendingStart;
    const b = dateIso;
    const startDay = a <= b ? a : b;
    const endDay = a <= b ? b : a;
    const to = addDays(endDay, 1);

    // Validate; on rejection, set a SPECIFIC reason (A-06) and restart from the
    // newly-clicked day rather than silently resetting with no feedback.
    const reason = validateCandidateRange({
      startDay,
      to,
      windowEnd,
      bookedDays,
    });
    if (reason) {
      setRejection(reason);
      setPendingStart(dateIso);
      return;
    }
    onChange({ fromISODate: startDay, toISODate: to });
    setPendingStart(null);
  }

  function moveFocus(deltaDays: number): void {
    const next = addDays(focusDay, deltaDays);
    if (next < today || next >= windowEnd) return; // clamp to the window
    shouldFocusRef.current = true;
    setFocusDay(next);
    if (pendingStart && !value) setPreviewDay(next); // keyboard preview (A-15)
  }

  function handleKeyDown(e: React.KeyboardEvent, dateIso: string): void {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-7);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(7);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(-isoWeekdayIndex(dateIso));
        break;
      case 'End':
        e.preventDefault();
        moveFocus(6 - isoWeekdayIndex(dateIso));
        break;
      case 'PageUp':
        e.preventDefault();
        moveFocus(-28);
        break;
      case 'PageDown':
        e.preventDefault();
        moveFocus(28);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isSelectableDay(dateIso)) handleSelect(dateIso);
        break;
      default:
        break;
    }
  }

  const canPrevMonth = monthStart(today) < viewMonth;
  // The forward chevron may advance as long as the SECOND displayed month is
  // still before the window edge.
  const canNextMonth = addMonths(viewMonth, 1) < monthStart(windowEnd);

  // The status line. A rejection (A-06) takes precedence; otherwise the normal
  // selection state.
  const status = (() => {
    if (rejection) return rejectionMessage(rejection);
    if (!vehicleId) return 'Choose a vehicle first to see availability.';
    if (value) {
      const days = diffDays(value.fromISODate, value.toISODate);
      return `Selected ${value.fromISODate} to ${addDays(value.toISODate, -1)} — ${String(days)} ${days === 1 ? 'day' : 'days'}.`;
    }
    if (pendingStart) {
      return `Pick-up ${pendingStart}. Now choose your return day.`;
    }
    return `Choose a pick-up day. Booked days are not selectable. Minimum ${String(MIN_RENTAL_DAYS)} day, maximum ${String(MAX_RENTAL_DAYS)} days.`;
  })();

  /**
   * Render one month grid (used once on mobile, twice side-by-side on lg+). Each
   * month is its OWN `role="grid"` (the standard two-month calendar pattern); a
   * single roving tabindex spans both because arrow keys move `focusDay` across
   * the boundary, and `aria-describedby` ties each grid to the shared status.
   */
  function MonthGrid({ month }: { month: string }): ReactNode {
    const monthLen = daysInMonth(month);
    const leadBlanks = isoWeekdayIndex(month);
    const cells: (string | null)[] = [];
    for (let i = 0; i < leadBlanks; i += 1) cells.push(null);
    for (let d = 1; d <= monthLen; d += 1) {
      cells.push(`${month.slice(0, 7)}-${String(d).padStart(2, '0')}`);
    }
    const headingId = `${statusId}-${month}`;

    return (
      <div className="min-w-0">
        <p
          id={headingId}
          className="text-foreground mb-2 text-center text-sm font-medium"
        >
          {monthLabelOf(month)}
        </p>
        <div
          role="grid"
          aria-labelledby={headingId}
          aria-describedby={statusId}
        >
          <div role="row" className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                role="columnheader"
                aria-label={w}
                className="text-fg-subtle pb-1 text-center text-[length:var(--text-2xs)] font-medium"
              >
                {w}
              </div>
            ))}
          </div>
          <div role="row" className="grid grid-cols-7 gap-1">
            {cells.map((dateIso, i) => {
              if (dateIso === null) {
                return (
                  <div
                    key={`blank-${month}-${String(i)}`}
                    role="gridcell"
                    aria-hidden="true"
                  />
                );
              }
              const selectable = isSelectableDay(dateIso);
              const inSel = dayInSelection(dateIso);
              const inPreview = dayInPreview(dateIso);
              const isStart = dateIso === selFrom;
              const isEnd = selTo ? dateIso === addDays(selTo, -1) : false;
              const isFocusTarget = dateIso === focusDay;
              const dayNum = Number(dateIso.slice(8, 10));
              const booked = isBooked(dateIso);

              let cellLabel = `${MONTH_NAMES[Number(dateIso.slice(5, 7)) - 1] ?? ''} ${String(dayNum)}`;
              if (booked) cellLabel += ', unavailable — already booked';
              else if (!selectable) cellLabel += ', unavailable';
              else if (isStart) cellLabel += ', selected pick-up day';
              else if (isEnd) cellLabel += ', selected return day';

              return (
                <div role="gridcell" key={dateIso} aria-selected={inSel}>
                  <button
                    type="button"
                    data-day={dateIso}
                    tabIndex={isFocusTarget ? 0 : -1}
                    disabled={!selectable}
                    aria-disabled={!selectable}
                    aria-label={cellLabel}
                    onClick={() => {
                      if (selectable) handleSelect(dateIso);
                    }}
                    onFocus={() => {
                      // Only sync the roving focus target. The preview band is
                      // driven by `moveFocus` (keyboard) + `onPointerEnter`
                      // (mouse) — NOT here: setting preview state inside onFocus
                      // caused a re-render cascade that blurred the just-focused
                      // cell (a selection then dropped focus to <body>).
                      setFocusDay((d) => (d === dateIso ? d : dateIso));
                    }}
                    onPointerEnter={() => {
                      if (selectable && pendingStart && !value) {
                        setPreviewDay(dateIso);
                      }
                    }}
                    onPointerLeave={() => { setPreviewDay(null); }}
                    onKeyDown={(e) => { handleKeyDown(e, dateIso); }}
                    className={cn(
                      'relative flex h-9 w-full items-center justify-center rounded-md text-sm tabular-nums outline-none transition-colors',
                      'focus-visible:outline-[2px] focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ring)]',
                      !selectable &&
                        'text-fg-subtle cursor-not-allowed line-through',
                      selectable &&
                        !inSel &&
                        !inPreview &&
                        'text-foreground hover:bg-surface-2',
                      inPreview && !inSel && 'bg-accent-soft/50 text-foreground',
                      inSel &&
                        !isStart &&
                        !isEnd &&
                        'bg-accent-soft text-accent-ink',
                      (isStart || isEnd) &&
                        'bg-accent text-accent-contrast font-medium',
                    )}
                  >
                    {dayNum}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-surface rounded-[var(--radius-lg)] border p-4 sm:p-5">
      {/* Month navigation. */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (canPrevMonth) setViewMonth(addMonths(viewMonth, -1));
          }}
          disabled={!canPrevMonth}
          aria-label="Previous month"
          className="text-fg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        {/* The visible month range, announced on change. */}
        <p aria-live="polite" className="text-fg-muted text-[length:var(--text-2xs)]">
          <span className="sr-only">Showing </span>
          {monthLabelOf(viewMonth)}
          <span className="hidden lg:inline">
            {' – '}
            {monthLabelOf(addMonths(viewMonth, 1))}
          </span>
        </p>
        <button
          type="button"
          onClick={() => {
            if (canNextMonth) setViewMonth(addMonths(viewMonth, 1));
          }}
          disabled={!canNextMonth}
          aria-label="Next month"
          className="text-fg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* Calendar — one month on mobile, two side-by-side on lg+ (A-07). Each
          month is its own `role="grid"`; a single roving tabindex spans both. */}
      <div
        ref={gridRef}
        onBlur={(e) => {
          // When focus leaves the grid entirely (Tab away), stop auto-restoring
          // focus — the grid must not yank focus back from the rest of the page.
          if (!e.currentTarget.contains(e.relatedTarget)) {
            keyboardActiveRef.current = false;
          }
        }}
        className="grid grid-cols-1 gap-5 lg:grid-cols-2"
      >
        <MonthGrid month={viewMonth} />
        {/* The second month is desktop-only; on mobile the forward chevron is
            the way through the 60-day window. */}
        <div className="hidden lg:block">
          <MonthGrid month={addMonths(viewMonth, 1)} />
        </div>
      </div>

      {/* Accessible status line — specific reasons, never silent (A-06). */}
      <p id={statusId} aria-live="polite" className="text-fg-muted mt-4 text-sm">
        {status}
      </p>
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange(undefined);
            setPendingStart(null);
            setRejection(null);
          }}
          className="text-accent-ink hover:text-foreground focus-visible:ring-ring mt-2 rounded text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Clear dates
        </button>
      ) : null}
    </div>
  );
}
