'use client';

import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '@/lib/cn';
import { formatCurrency } from '@/lib/format';
import { priceQuote } from '@/lib/pricing';
import {
  draftIsOneWay,
  draftRentalDays,
} from '@/lib/store/wizard-machine';
import { useReservationStore } from '@/lib/store/reservation-store';
import {
  CONFIGURATOR_OPTIONS,
  EXTRAS,
  getExtraById,
  getInsuranceByTier,
  getLocationById,
  getVehicleById,
} from '@/mocks';
import { ONE_WAY_FEE_MINOR } from '@/lib/pricing';

/**
 * The live price summary rail (Task 5.4) — present from the dates step onward.
 *
 * Reads the draft from the store, recomputes the pure `priceQuote` on every
 * render (cheap, deterministic), and renders the running selection + the live
 * total. The TOTAL sits in an `aria-live="polite"` region so screen-reader
 * users hear it update as extras/insurance/dates change (the price is the most
 * consequential changing value in the flow).
 *
 * Two variants:
 *   - `rail`  — the desktop side rail (sticky), the full breakdown.
 *   - `bar`   — the mobile sticky bottom bar, a condensed total + optional
 *               primary action (so the advance CTA is never below the fold).
 *
 * Currency formatting reuses `lib/format.ts` (fixed en-GB locale) — never
 * re-derived (the Phase-5 handoff rule).
 */

interface PrimaryAction {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

interface SummaryRailProps {
  variant: 'rail' | 'bar';
  primaryAction?: PrimaryAction;
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={cn('text-sm', emphasis ? 'text-foreground' : 'text-fg-muted')}>
        {label}
      </span>
      <span
        className={cn(
          'tabular-nums',
          emphasis
            ? 'text-foreground text-sm font-medium'
            : 'text-fg-muted text-sm',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SummaryRail({
  variant,
  primaryAction,
}: SummaryRailProps): ReactNode {
  // Subscribe to ONLY the price-relevant fields with a shallow-equality
  // selector (A-20) — the rail no longer re-renders on every driver-field
  // keystroke (the old whole-store `(s) => s` subscription did). `extras` is a
  // new array reference on each toggle, which shallow-compares correctly.
  const draft = useReservationStore(
    useShallow((s) => ({
      vehicleId: s.vehicleId,
      config: s.config,
      range: s.range,
      pickupLocationId: s.pickupLocationId,
      returnLocationId: s.returnLocationId,
      extras: s.extras,
      insuranceTier: s.insuranceTier,
    })),
  );

  const vehicle = draft.vehicleId ? getVehicleById(draft.vehicleId) : undefined;
  const rentalDays = draftRentalDays(draft);
  const oneWay = draftIsOneWay(draft);

  const quote = vehicle
    ? priceQuote({
        vehicle,
        rentalDays,
        extras: draft.extras,
        ...(draft.insuranceTier !== undefined && {
          insuranceTier: draft.insuranceTier,
        }),
        oneWay,
        catalog: EXTRAS,
      })
    : undefined;

  const currency = vehicle?.currency ?? 'EUR';
  const totalLabel = quote ? formatCurrency(quote.total, currency) : '—';

  const color = draft.config
    ? CONFIGURATOR_OPTIONS.colors.find((c) => c.id === draft.config?.colorId)
    : undefined;
  const wheel = draft.config
    ? CONFIGURATOR_OPTIONS.wheels.find((w) => w.id === draft.config?.wheelId)
    : undefined;

  const pickup = draft.pickupLocationId
    ? getLocationById(draft.pickupLocationId)
    : undefined;
  const ret = draft.returnLocationId
    ? getLocationById(draft.returnLocationId)
    : undefined;
  const insurance = draft.insuranceTier
    ? getInsuranceByTier(draft.insuranceTier)
    : undefined;
  const selectedExtras = draft.extras
    .map((id) => getExtraById(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  // ---- Mobile bar -------------------------------------------------------
  if (variant === 'bar') {
    return (
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
            {rentalDays > 0
              ? `Total · ${String(rentalDays)} ${rentalDays === 1 ? 'day' : 'days'}`
              : 'Estimated total'}
          </p>
          <p
            aria-live="polite"
            className="text-foreground text-[length:var(--text-xl)] font-semibold tabular-nums"
          >
            {totalLabel}
          </p>
        </div>
        {primaryAction ? (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-11 items-center rounded-md px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40"
          >
            {primaryAction.label}
          </button>
        ) : null}
      </div>
    );
  }

  // ---- Desktop rail -----------------------------------------------------
  return (
    <div className="border-border bg-surface rounded-[var(--radius-xl)] border p-6 shadow-[var(--shadow-card)]">
      <h2 className="text-fg-subtle text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
        Your reservation
      </h2>

      {/* Selection summary. */}
      <dl className="mt-4 space-y-3 border-b border-[var(--color-border)] pb-5">
        <div>
          <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
            Vehicle
          </dt>
          <dd className="text-foreground mt-0.5 text-sm font-medium">
            {vehicle ? vehicle.name : 'Not chosen yet'}
          </dd>
          {color && wheel ? (
            <dd className="text-fg-muted mt-0.5 text-[length:var(--text-2xs)]">
              {color.name} · {wheel.name}
            </dd>
          ) : null}
        </div>

        <div>
          <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
            Dates
          </dt>
          <dd className="text-foreground mt-0.5 text-sm">
            {draft.range
              ? `${draft.range.fromISODate} → ${draft.range.toISODate} (${String(rentalDays)} ${rentalDays === 1 ? 'day' : 'days'})`
              : 'Not chosen yet'}
          </dd>
        </div>

        {pickup || ret ? (
          <div>
            <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
              Pick-up / return
            </dt>
            <dd className="text-foreground mt-0.5 text-sm">
              {pickup?.name ?? '—'}
              {oneWay ? ` → ${ret?.name ?? '—'}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Price breakdown. */}
      {quote && rentalDays > 0 ? (
        <div className="mt-5 space-y-2">
          <Row
            label={`${formatCurrency(vehicle?.dailyPriceMinor ?? 0, currency)} × ${String(rentalDays)} ${rentalDays === 1 ? 'day' : 'days'}`}
            value={formatCurrency(quote.base, currency)}
          />
          {selectedExtras.map((extra) => (
            <Row
              key={extra.id}
              label={extra.name}
              value={
                extra.pricing === 'per-day'
                  ? formatCurrency(extra.priceMinor * rentalDays, currency)
                  : formatCurrency(extra.priceMinor, currency)
              }
            />
          ))}
          {insurance ? (
            <Row
              label={`${insurance.name} cover`}
              value={formatCurrency(quote.insuranceTotal, currency)}
            />
          ) : null}
          {oneWay ? (
            <Row
              label="One-way fee"
              value={formatCurrency(ONE_WAY_FEE_MINOR, currency)}
            />
          ) : null}
          {quote.discount > 0 ? (
            <Row
              label="Multi-day discount"
              value={`− ${formatCurrency(quote.discount, currency)}`}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-fg-subtle mt-5 text-sm">
          Pick your dates to see the price.
        </p>
      )}

      {/* The live total — the aria-live region. */}
      <div className="mt-5 flex items-baseline justify-between border-t border-[var(--color-border)] pt-5">
        <span className="text-foreground text-sm font-medium">Total</span>
        <span
          aria-live="polite"
          className="text-foreground text-[length:var(--text-2xl)] font-semibold tabular-nums"
        >
          {totalLabel}
        </span>
      </div>
      <p className="text-fg-subtle mt-2 text-[length:var(--text-2xs)]">
        Includes all taxes. No card is charged — this is a demo.
      </p>
    </div>
  );
}
