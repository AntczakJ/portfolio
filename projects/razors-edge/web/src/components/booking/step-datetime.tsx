'use client';

import { useEffect, useMemo, type ReactNode } from 'react';

import { resolveAnyBarber } from '@/lib/store/booking-machine';
import { BARBERS, getBarberById, getServiceById } from '@/mocks';
import type { Barber } from '@/lib/schemas/barber';

import { AvailabilityGrid } from './availability-grid';
import { DateStrip, isBarberOpenOn } from './date-strip';
import { StepShell } from './step-shell';

interface StepDateTimeProps {
  serviceId: string;
  barberId: string | undefined;
  anyBarber: boolean | undefined;
  date: string | undefined;
  startMin: number | undefined;
  onSelectDate: (date: string) => void;
  onSelectSlot: (startMin: number) => void;
  /** Pin the concrete barber an "any" booking resolved to (keeps the flag). */
  onResolveBarber: (barberId: string) => void;
}

/**
 * Step 3 — date & time (ADR-003).
 *
 * Composes the date strip (next bookable days from the frozen `now`) and
 * the accessible availability grid. The grid is duration-aware so a combo
 * consumes a longer block; unavailable slots render disabled + labelled.
 *
 * "Any available barber" handling: the strip offers any day at least one
 * eligible barber works; once a date is chosen we resolve the sentinel to
 * a concrete barber (first eligible barber free that day) and pin it, so
 * the grid + submit have a real id while the summary still reads "Any".
 */
export function StepDateTime({
  serviceId,
  barberId,
  anyBarber,
  date,
  startMin,
  onSelectDate,
  onSelectSlot,
  onResolveBarber,
}: StepDateTimeProps): ReactNode {
  const service = getServiceById(serviceId);

  // The candidate barbers that drive which days the strip offers.
  const candidateBarbers = useMemo<Barber[]>(() => {
    if (anyBarber) {
      return BARBERS.filter((b) => b.serviceIds.includes(serviceId));
    }
    const b = barberId ? getBarberById(barberId) : undefined;
    return b ? [b] : [];
  }, [anyBarber, barberId, serviceId]);

  // For "any", resolve the concrete barber for the chosen date.
  const resolvedBarberId = useMemo(() => {
    if (!date) return undefined;
    if (anyBarber) return resolveAnyBarber(serviceId, date);
    return barberId;
  }, [anyBarber, barberId, date, serviceId]);

  // Pin the resolved barber so the store + submit carry a real id.
  useEffect(() => {
    if (anyBarber && resolvedBarberId && resolvedBarberId !== barberId) {
      onResolveBarber(resolvedBarberId);
    }
  }, [anyBarber, resolvedBarberId, barberId, onResolveBarber]);

  const gridBarber = resolvedBarberId
    ? getBarberById(resolvedBarberId)
    : undefined;
  const dayOpenForBarber =
    date && gridBarber ? isBarberOpenOn(gridBarber, date) : false;

  return (
    <StepShell
      eyebrow="Step three"
      title="When suits you?"
      lead="Pick a day, then a time. Greyed times are already taken or fall outside the chair&rsquo;s hours."
    >
      <div className="flex flex-col gap-8">
        <div>
          <h3 className="text-fg-muted mb-3 text-sm tracking-wide uppercase">
            Date
          </h3>
          <DateStrip
            selectedDate={date}
            onSelectDate={onSelectDate}
            barbers={candidateBarbers}
          />
        </div>

        <div>
          <h3 className="text-fg-muted mb-3 text-sm tracking-wide uppercase">
            Time
          </h3>
          {!date ? (
            <p className="text-fg-subtle text-sm">
              Choose a date above to see available times.
            </p>
          ) : !resolvedBarberId || !gridBarber ? (
            <p className="text-fg-muted text-sm">
              No barber is free on this day. Please choose another date.
            </p>
          ) : !dayOpenForBarber ? (
            <p className="text-fg-muted text-sm">
              This chair is closed on the selected day. Please choose
              another date.
            </p>
          ) : (
            <>
              {/* `gridBarber` is already narrowed to non-null by the guard
                  branches above, so only the `anyBarber` flag gates this. */}
              {anyBarber ? (
                <p className="text-fg-subtle mb-3 text-sm">
                  First free this day:{' '}
                  <span className="text-brass-text">{gridBarber.name}</span>
                </p>
              ) : null}
              <AvailabilityGrid
                barberId={resolvedBarberId}
                serviceId={serviceId}
                date={date}
                serviceDurationMin={service?.durationMin ?? 30}
                selectedStartMin={startMin}
                onSelectSlot={onSelectSlot}
              />
            </>
          )}
        </div>
      </div>
    </StepShell>
  );
}
