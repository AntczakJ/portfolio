'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatDailyPrice } from '@/lib/format';
import { useVehicles } from '@/lib/queries/reservation-queries';
import type { ReservationConfig } from '@/lib/schemas/reservation-draft';
import { CONFIGURATOR_OPTIONS } from '@/mocks';
import { ThemedImage } from '@/components/sections/themed-image';

import { StepShell } from './step-shell';

/**
 * Step 1 — Pick a vehicle (Task 5.5).
 *
 * Reflects the carried-over configuration: when the user arrived from the
 * configurator / a flagship deep link, the chosen vehicle is pre-selected and
 * its config (colour + wheels) is shown on the card (the spine thread). The
 * fleet is fetched through the TanStack Query mock layer so the loading state is
 * idiomatic. Every card is a `role="radio"` in a `role="radiogroup"`; selecting
 * a DIFFERENT vehicle than the carried one clears the now-irrelevant config +
 * range (handled in the store's `selectVehicle`).
 */
interface StepVehicleProps {
  selectedVehicleId: string | undefined;
  config: ReservationConfig | undefined;
  onSelect: (vehicleId: string) => void;
}

export function StepVehicle({
  selectedVehicleId,
  config,
  onSelect,
}: StepVehicleProps): ReactNode {
  const { data: vehicles, isPending } = useVehicles();

  const ordered = vehicles
    ? [...vehicles].sort((a, b) => {
        if (a.configurable !== b.configurable) return a.configurable ? -1 : 1;
        return b.dailyPriceMinor - a.dailyPriceMinor;
      })
    : [];

  const color = config
    ? CONFIGURATOR_OPTIONS.colors.find((c) => c.id === config.colorId)
    : undefined;
  const wheel = config
    ? CONFIGURATOR_OPTIONS.wheels.find((w) => w.id === config.wheelId)
    : undefined;

  return (
    <StepShell
      eyebrow="Step 1"
      title="Pick your car"
      description="Choose any car in the fleet. If you configured the flagship, it is already selected with your paint and wheels."
    >
      {isPending ? (
        <div
          className="grid gap-4 sm:grid-cols-2"
          aria-busy="true"
          aria-label="Loading the fleet"
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-border bg-surface h-56 animate-pulse rounded-[var(--radius-lg)] border"
            />
          ))}
        </div>
      ) : (
        <div role="radiogroup" aria-label="Vehicle" className="grid gap-4 sm:grid-cols-2">
          {ordered.map((vehicle) => {
            const checked = vehicle.id === selectedVehicleId;
            const showConfig = checked && vehicle.configurable && color && wheel;
            return (
              <button
                key={vehicle.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => { onSelect(vehicle.id); }}
                className={cn(
                  'group relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border text-left transition-colors outline-none',
                  'focus-visible:outline-[2px] focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
                  checked
                    ? 'border-accent ring-accent/30 bg-surface ring-2'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <div className="bg-surface-2 relative aspect-[16/10] w-full overflow-hidden">
                  <ThemedImage
                    lightSrc={vehicle.heroRenderSrc}
                    alt={`${vehicle.name} — APEX studio render`}
                    sizes="(min-width: 640px) 40vw, 92vw"
                    className="object-contain"
                  />
                  {checked ? (
                    <span className="bg-accent text-accent-contrast absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-full">
                      <Check className="size-4" aria-hidden="true" />
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-foreground text-[length:var(--text-lg)] font-semibold">
                      {vehicle.name}
                    </h2>
                    <p className="text-foreground text-sm font-medium tabular-nums whitespace-nowrap">
                      {formatDailyPrice(vehicle.dailyPriceMinor, vehicle.currency)}
                    </p>
                  </div>
                  <p className="text-fg-muted mt-1 text-sm">
                    {vehicle.rangeKm} km · {vehicle.accel0to100.toFixed(1)}s 0-100 ·{' '}
                    {vehicle.seats} seats
                  </p>
                  {showConfig ? (
                    <p className="text-accent-ink mt-3 text-[length:var(--text-2xs)] font-medium tracking-[var(--tracking-wide)] uppercase">
                      Your config · {color.name} / {wheel.name}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </StepShell>
  );
}
