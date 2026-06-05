'use client';

import { Building2, Plane, Warehouse } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';

import { cn } from '@/lib/cn';
import {
  useDisabledRanges,
  useLocations,
  useRangeAvailability,
} from '@/lib/queries/reservation-queries';
import type { DateRange } from '@/lib/schemas/availability';
import type { LocationKind } from '@/lib/schemas/common';
import type { Location } from '@/lib/schemas/location';

import { DateRangePicker } from './date-range-picker';
import { StepShell } from './step-shell';

/**
 * Step 2 — Dates + pickup/return locations (Task 5.5).
 *
 * The accessible date-range picker (its own keyboard widget) wired to
 * `getDisabledRanges` (booked days greyed) + `getRangeAvailability` (a specific,
 * accessible availability verdict for the chosen range) via the TanStack Query
 * mock layer. Pickup + return are radio groups over the mock locations; a
 * different return triggers the flat one-way surcharge (shown in the rail).
 */

const LOCATION_ICON: Record<
  LocationKind,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  airport: Plane,
  city: Building2,
  depot: Warehouse,
};

interface StepDatesLocationsProps {
  vehicleId: string | undefined;
  range: DateRange | undefined;
  pickupLocationId: string | undefined;
  returnLocationId: string | undefined;
  onChangeRange: (range: DateRange | undefined) => void;
  onChangePickup: (id: string) => void;
  onChangeReturn: (id: string) => void;
}

function LocationGroup({
  legend,
  name,
  locations,
  selectedId,
  onSelect,
}: {
  legend: string;
  name: string;
  locations: readonly Location[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}): ReactNode {
  return (
    <fieldset>
      <legend className="text-fg-muted text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
        {legend}
      </legend>
      <div role="radiogroup" aria-label={legend} className="mt-3 grid gap-2">
        {locations.map((loc) => {
          const Icon = LOCATION_ICON[loc.kind];
          const checked = loc.id === selectedId;
          return (
            <label
              key={loc.id}
              className={cn(
                'group flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border p-3 transition-colors',
                checked
                  ? 'border-accent bg-accent-soft/40'
                  : 'border-border bg-surface hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name={name}
                value={loc.id}
                checked={checked}
                onChange={() => { onSelect(loc.id); }}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-md',
                  'peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-[var(--color-foreground)]',
                  checked
                    ? 'bg-accent text-accent-contrast'
                    : 'bg-surface-2 text-fg-muted',
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="text-foreground block text-sm font-medium">
                  {loc.name}
                </span>
                <span className="text-fg-subtle block truncate text-[length:var(--text-2xs)]">
                  {loc.address}, {loc.city}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function StepDatesLocations({
  vehicleId,
  range,
  pickupLocationId,
  returnLocationId,
  onChangeRange,
  onChangePickup,
  onChangeReturn,
}: StepDatesLocationsProps): ReactNode {
  const { data: locations, isPending: locationsPending } = useLocations();
  const { data: disabledRanges } = useDisabledRanges(vehicleId);
  const { data: availability } = useRangeAvailability({
    vehicleId,
    fromISODate: range?.fromISODate,
    toISODate: range?.toISODate,
  });

  const oneWay = Boolean(
    pickupLocationId && returnLocationId && pickupLocationId !== returnLocationId,
  );

  return (
    <StepShell
      eyebrow="Step 2"
      title="Dates & places"
      description="Pick your rental dates, then where you will collect and return the car. Booked days are greyed out."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Date range. */}
        <div>
          <DateRangePicker
            vehicleId={vehicleId}
            disabledRanges={disabledRanges ?? []}
            value={range}
            onChange={onChangeRange}
          />
          {/* The availability verdict for the chosen range (specific reason). */}
          {range && availability ? (
            <p
              role="status"
              className={cn(
                'mt-3 text-sm',
                availability.available ? 'text-accent-ink' : 'text-danger-ink',
              )}
            >
              {availability.available
                ? 'These dates are available.'
                : availability.reason === 'conflict'
                  ? 'These dates overlap an existing booking — please pick another range.'
                  : availability.reason === 'too-short'
                    ? 'The minimum rental is one day.'
                    : availability.reason === 'too-long'
                      ? 'That exceeds the maximum rental length.'
                      : 'Those dates are outside the bookable window.'}
            </p>
          ) : null}
        </div>

        {/* Locations. */}
        <div className="grid gap-6">
          {locationsPending || !locations ? (
            <div
              className="grid gap-3"
              aria-busy="true"
              aria-label="Loading locations"
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="border-border bg-surface h-16 animate-pulse rounded-[var(--radius-md)] border"
                />
              ))}
            </div>
          ) : (
            <>
              <LocationGroup
                legend="Pick-up"
                name="apex-pickup"
                locations={locations}
                selectedId={pickupLocationId}
                onSelect={onChangePickup}
              />
              <LocationGroup
                legend="Return"
                name="apex-return"
                locations={locations}
                selectedId={returnLocationId}
                onSelect={onChangeReturn}
              />
              {oneWay ? (
                <p className="text-fg-muted border-border bg-surface-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
                  Different return location — a one-way fee applies (shown in your
                  summary).
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </StepShell>
  );
}
