'use client';

import type { ReactNode } from 'react';

import { useAvailability } from '@/lib/queries/booking-queries';
import { formatTime, formatTimeRange } from '@/lib/format';
import { cn } from '@/lib/cn';
import type {
  AvailabilitySlot,
  SlotUnavailableReason,
} from '@/lib/schemas/availability';

import { rovingTabIndex, useRadiogroupKeys } from './use-radiogroup-keys';

interface AvailabilityGridProps {
  barberId: string;
  serviceId: string;
  date: string;
  serviceDurationMin: number;
  selectedStartMin: number | undefined;
  onSelectSlot: (startMin: number) => void;
}

/**
 * The availability grid (ADR-003) — an accessible time-slot widget.
 *
 * Slots come from `useAvailability` (TanStack Query → the pure
 * `getAvailability`). Per ADR-003, UNAVAILABLE slots render DISABLED and
 * VISIBLE (never hidden), each carrying an accessible label with the time
 * AND the reason it is unavailable (booked / lunch / past / overflow). A
 * combo's longer duration consumes a longer block automatically (the grid
 * is duration-aware via the query).
 *
 * Accessibility: a `radiogroup` of slot buttons. Available slots are real,
 * focusable `radio`s; disabled slots use `aria-disabled` (kept in the tab
 * order so a screen-reader user can still hear "10:30, already booked"
 * rather than the slot vanishing). Each label includes the full time range
 * for the chosen service so the user knows the block they are reserving.
 */
export function AvailabilityGrid({
  barberId,
  serviceId,
  date,
  serviceDurationMin,
  selectedStartMin,
  onSelectSlot,
}: AvailabilityGridProps): ReactNode {
  const {
    data: slots,
    isPending,
    isFetching,
    isError,
  } = useAvailability({ barberId, serviceId, date });

  // `data-rg-index` carries each available slot's `startMin`, so the
  // radiogroup keyboard handler selects by start minute directly.
  const handleKeyDown = useRadiogroupKeys((startMin) => {
    onSelectSlot(startMin);
  });

  if (isError) {
    return (
      <p role="alert" className="text-danger text-sm">
        We could not load this day&rsquo;s times. Please pick another date.
      </p>
    );
  }

  if (isPending) {
    return <GridSkeleton />;
  }

  if (slots.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        This barber is not working on the selected day. Please choose
        another date.
      </p>
    );
  }

  const availableCount = slots.filter((s) => s.available).length;
  const firstAvailableStartMin = slots.find((s) => s.available)?.startMin;
  const anySelected = slots.some(
    (s) => s.available && s.startMin === selectedStartMin,
  );

  return (
    <div aria-busy={isFetching}>
      <p className="text-fg-subtle mb-4 text-sm" aria-live="polite">
        {availableCount > 0
          ? `${String(availableCount)} ${availableCount === 1 ? 'time' : 'times'} available`
          : 'No times left on this day — try another date.'}
      </p>
      <div
        role="radiogroup"
        aria-label="Choose a start time"
        // Roving-tabindex composite: focus lives on the radios, not the group.
        // `tabIndex={-1}` keeps the group programmatically focusable (and out of
        // the tab sequence) so the keydown handler has a valid focus host.
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        // D-05: auto-fill + minmax so the grid reflows to whatever fits the
        // container (down to a 320px wizard column) instead of forcing 3
        // fixed columns that clip the right edge on mobile. The min track is
        // sized for a phone (4.25rem holds "10:30" comfortably); on wider
        // containers it packs more columns automatically. No fixed col count,
        // no clipping.
        style={{
          gridTemplateColumns:
            'repeat(auto-fill, minmax(min(4.25rem, 100%), 1fr))',
        }}
        className="grid gap-2"
      >
        {slots.map((slot) => {
          const checked =
            slot.available && slot.startMin === selectedStartMin;
          return (
            <SlotButton
              key={slot.startMin}
              slot={slot}
              serviceDurationMin={serviceDurationMin}
              checked={checked}
              tabIndex={
                slot.available
                  ? rovingTabIndex({
                      isSelected: checked,
                      anySelected,
                      isFirstSelectable:
                        slot.startMin === firstAvailableStartMin,
                    })
                  : -1
              }
              onSelect={() => {
                onSelectSlot(slot.startMin);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

const REASON_LABEL: Record<SlotUnavailableReason, string> = {
  closed: 'closed',
  'day-off': 'barber off',
  booked: 'already booked',
  lunch: 'lunch break',
  past: 'already passed',
  'overflows-close': 'too late to finish',
};

function SlotButton({
  slot,
  serviceDurationMin,
  checked,
  tabIndex,
  onSelect,
}: {
  slot: AvailabilitySlot;
  serviceDurationMin: number;
  checked: boolean;
  tabIndex: 0 | -1;
  onSelect: () => void;
}): ReactNode {
  const time = formatTime(slot.startMin);

  if (!slot.available) {
    const reason = REASON_LABEL[slot.reason];
    return (
      <button
        type="button"
        aria-disabled="true"
        tabIndex={-1}
        aria-label={`${time}, unavailable — ${reason}`}
        // Visible + in the AT tree (ADR-003) but never tabbable or selectable;
        // arrow navigation in the radiogroup skips it (it is not a role=radio).
        onClick={(e) => {
          e.preventDefault();
        }}
        className="border-border/60 text-fg-subtle relative cursor-not-allowed rounded-md border border-dashed bg-transparent py-2.5 text-sm tabular-nums line-through decoration-[var(--color-border-strong)] opacity-60"
      >
        {time}
      </button>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      data-rg-index={slot.startMin}
      aria-label={`${formatTimeRange(slot.startMin, serviceDurationMin)}, available`}
      onClick={onSelect}
      className={cn(
        'focus-visible:ring-ring relative rounded-md border py-2.5 text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none',
        checked
          ? 'border-[var(--color-edge-glow)] bg-[var(--color-edge-glow)] font-medium text-[var(--color-on-brass)]'
          : 'border-border-strong text-fg hover:border-[var(--color-edge-glow)] hover:bg-surface/60',
      )}
    >
      {time}
    </button>
  );
}

function GridSkeleton(): ReactNode {
  return (
    <div aria-hidden="true">
      <div className="bg-surface/60 mb-4 h-4 w-32 rounded" />
      <div
        style={{
          gridTemplateColumns:
            'repeat(auto-fill, minmax(min(4.25rem, 100%), 1fr))',
        }}
        className="grid gap-2"
      >
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface/20 h-10 animate-pulse rounded-md border"
          />
        ))}
      </div>
    </div>
  );
}
