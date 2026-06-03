'use client';

import { useRef, type ReactNode } from 'react';

import { upcomingISODates, weekdayOfISODate } from '@/lib/clock';
import { formatDateShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Barber } from '@/lib/schemas/barber';

import { rovingTabIndex, useRadiogroupKeys } from './use-radiogroup-keys';

interface DateStripProps {
  selectedDate: string | undefined;
  onSelectDate: (date: string) => void;
  /** The candidate barbers (resolved barber, or all eligible for "any"). */
  barbers: readonly Barber[];
  /** Number of days to offer from the frozen "today". */
  days?: number;
}

/**
 * The date strip (ADR-003) — the next N bookable studio-local days from the
 * frozen `now`. A day is OFFERED only if at least one candidate barber is
 * open that day (non-null weekday schedule and not a day-off); fully-closed
 * days are omitted so the user never lands on an empty grid by accident.
 *
 * Rendered as a horizontally-scrollable `radiogroup` of day buttons —
 * keyboard-operable (Tab to the group, arrow/Tab between days, Space/Enter
 * to choose), each day a real `radio` with an accessible date label.
 */
export function DateStrip({
  selectedDate,
  onSelectDate,
  barbers,
  days = 14,
}: DateStripProps): ReactNode {
  const listRef = useRef<HTMLDivElement>(null);

  const candidates = upcomingISODates(days).filter((date) =>
    barbers.some((barber) => isBarberOpenOn(barber, date)),
  );

  const handleKeyDown = useRadiogroupKeys((index) => {
    const date = candidates[index];
    if (date) onSelectDate(date);
  });
  const anySelected = candidates.some((date) => date === selectedDate);

  return (
    <div>
      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Choose a date"
        // Roving-tabindex composite: focus lives on the day radios, not the
        // group; `tabIndex={-1}` keeps the group a valid keydown focus host
        // without entering the tab sequence.
        tabIndex={-1}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]"
        onKeyDown={handleKeyDown}
      >
        {candidates.map((date, index) => {
          const { weekday, day } = formatDateShort(date);
          const checked = date === selectedDate;
          return (
            <button
              key={date}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={fullDateLabel(date)}
              tabIndex={rovingTabIndex({
                isSelected: checked,
                anySelected,
                isFirstSelectable: index === 0,
              })}
              data-rg-index={index}
              onClick={() => {
                onSelectDate(date);
              }}
              className={cn(
                'focus-visible:ring-ring flex min-w-[3.75rem] shrink-0 flex-col items-center gap-1 rounded-lg border px-3 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none',
                checked
                  ? 'border-[var(--color-edge-glow)] bg-surface/60'
                  : 'border-border bg-surface/20 hover:border-border-strong hover:bg-surface/40',
              )}
            >
              <span
                className={cn(
                  'text-xs tracking-wide uppercase',
                  checked ? 'text-brass-text' : 'text-fg-subtle',
                )}
              >
                {weekday}
              </span>
              <span
                className={cn(
                  'font-display text-[length:var(--text-h3)] tabular-nums [font-variation-settings:"opsz"_40,"wght"_500]',
                  checked ? 'text-fg' : 'text-fg-muted',
                )}
              >
                {day}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Is a barber open (working + not off) on a studio-local date? */
export function isBarberOpenOn(barber: Barber, date: string): boolean {
  if (barber.daysOff.includes(date)) return false;
  const weekday = weekdayOfISODate(date);
  return barber.workingHours[weekday] !== null;
}

function fullDateLabel(date: string): string {
  // A spoken, unambiguous label for the radio (the visible chip is terse).
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][d.getUTCDay()];
  const month = [
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
  ][d.getUTCMonth()];
  // getUTCDay() (0-6) and getUTCMonth() (0-11) are always valid indices; the
  // `?? ''` fallbacks are unreachable but satisfy noUncheckedIndexedAccess.
  return `${weekday ?? ''} ${String(d.getUTCDate())} ${month ?? ''}`;
}
