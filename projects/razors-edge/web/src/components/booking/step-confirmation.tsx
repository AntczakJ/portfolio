'use client';

import { CalendarPlus, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EdgeRule, EdgeTick } from '@/components/chrome/edge-marks';
import {
  formatDateLong,
  formatDuration,
  formatPrice,
  formatTimeRange,
} from '@/lib/format';
import { downloadBookingIcs } from '@/lib/ics';
import { SHOP } from '@/mocks';
import type { ConfirmedBooking } from '@/lib/schemas/booking';

import { useFocusStepHeadingOnMount } from './step-shell';

interface StepConfirmationProps {
  confirmation: ConfirmedBooking;
  onBookAnother: () => void;
}

/**
 * Step 5 — confirmation (ADR-003).
 *
 * Shows the deterministic `reference`, a full summary (service, barber,
 * date/time, price, location), a client-side `.ics` download (hand-rolled,
 * no dependency), the honest "this is a demo" line, and the two onward
 * actions: "Book another" (reset) and "Back to the studio".
 *
 * The "clean edge" motif lands here as the final brass flourish: a lit
 * brass seal over the reference, echoing the hero's honed-edge highlight.
 */
export function StepConfirmation({
  confirmation,
  onBookAnother,
}: StepConfirmationProps): ReactNode {
  const headingRef = useFocusStepHeadingOnMount<HTMLHeadingElement>();
  const {
    reference,
    serviceName,
    barberName,
    date,
    startMin,
    durationMin,
    priceMinor,
    currency,
    contact,
  } = confirmation;

  function handleAddToCalendar(): void {
    downloadBookingIcs({
      booking: confirmation,
      location: {
        name: SHOP.name,
        street: SHOP.address.street,
        city: SHOP.address.city,
        postalCode: SHOP.address.postalCode,
        country: SHOP.address.country,
      },
    });
  }

  return (
    <div className="text-center">
      {/* Brass seal + the "clean edge" flourish (D-04): the brand's drawn
          razor edge draws the confirmation tick, and the razor's lit line is
          drawn clean underneath — the blade motif, not a stock check-tick. */}
      <div className="relative mx-auto flex flex-col items-center">
        <span
          aria-hidden="true"
          className="border-brass-muted/40 bg-[var(--color-edge-glow)]/10 text-fg flex size-16 items-center justify-center rounded-full border"
        >
          <EdgeTick className="size-8" />
        </span>
        <span
          aria-hidden="true"
          className="mt-6 block drop-shadow-[0_0_var(--edge-glow-blur)_var(--color-edge-glow)]"
        >
          <EdgeRule width={112} />
        </span>
      </div>

      <p className="text-brass-text mt-6 text-[length:var(--text-caption)] tracking-[0.28em] uppercase">
        Confirmed
      </p>
      <h2
        ref={headingRef}
        id="wizard-step-heading"
        tabIndex={-1}
        className="font-display text-fg mt-3 text-[length:var(--text-h1)] leading-[1.05] [font-variation-settings:'opsz'_120,'wght'_440,'SOFT'_0] focus-visible:outline-none"
      >
        You are booked in.
      </h2>
      <p className="text-fg-muted mx-auto mt-4 max-w-md text-balance text-[length:var(--text-body-lg)] leading-relaxed">
        Your chair is held, {contact.name.split(' ')[0]}. Here is everything
        in one place.
      </p>

      {/* Reference. */}
      <div className="border-border bg-surface/40 mx-auto mt-10 max-w-md rounded-lg border p-6">
        <p className="text-fg-subtle text-xs tracking-[0.18em] uppercase">
          Booking reference
        </p>
        <p className="font-display text-fg mt-2 text-[length:var(--text-h2)] tracking-[0.12em] tabular-nums [font-variation-settings:'opsz'_72,'wght'_520]">
          {reference}
        </p>

        <dl className="border-border mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 border-t pt-6 text-left text-sm">
          <Row label="Service" value={`${serviceName} · ${formatDuration(durationMin)}`} />
          <Row label="Barber" value={barberName} />
          <Row label="Date" value={formatDateLong(date)} />
          <Row label="Time" value={formatTimeRange(startMin, durationMin)} />
          <Row
            label="Location"
            value={
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="text-brass-text size-3.5" aria-hidden="true" />
                {SHOP.address.street}, {SHOP.address.city}
              </span>
            }
          />
          <dt className="text-fg-muted border-border col-start-1 mt-1 self-center border-t pt-3">
            Total
          </dt>
          <dd className="text-fg border-border col-start-2 mt-1 self-center border-t pt-3 text-right tabular-nums">
            {formatPrice(priceMinor, currency)}
          </dd>
        </dl>
      </div>

      {/* Add to calendar. */}
      <button
        type="button"
        onClick={handleAddToCalendar}
        className="border-border-strong text-fg hover:border-[var(--color-edge-glow)] hover:text-brass-text focus-visible:ring-ring mx-auto mt-6 inline-flex h-11 items-center gap-2 rounded-md border px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none"
      >
        <CalendarPlus className="size-4" aria-hidden="true" />
        Add to calendar (.ics)
      </button>

      {/* Honest demo line. */}
      <p className="text-fg-subtle mx-auto mt-8 max-w-sm text-balance text-xs leading-relaxed">
        This is a demo. No real appointment was scheduled and no details were
        sent or stored anywhere — a reload starts a fresh booking.
      </p>

      {/* Onward actions. */}
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onBookAnother}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-11 items-center justify-center rounded-md px-7 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none"
        >
          Book another
        </button>
        <Link
          href="/"
          className="text-fg-muted hover:text-fg focus-visible:ring-ring inline-flex h-11 items-center justify-center rounded-md px-5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          Back to the studio
        </Link>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}): ReactNode {
  // `<dt>`/`<dd>` are DIRECT children of the parent `<dl>` (a 2-col grid) so
  // the definition-list structure is valid (Lighthouse `dlitem`).
  return (
    <>
      <dt className="text-fg-subtle col-start-1 shrink-0 self-baseline">
        {label}
      </dt>
      <dd className="text-fg col-start-2 self-baseline text-right">{value}</dd>
    </>
  );
}
