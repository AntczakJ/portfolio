'use client';

import { useQuery } from '@tanstack/react-query';

import {
  fetchAvailability,
  fetchBarbers,
  fetchServices,
  type AvailabilityRequest,
} from '@/mocks';
import type { AvailabilitySlot } from '@/lib/schemas/availability';
import type { Barber } from '@/lib/schemas/barber';
import type { Service } from '@/lib/schemas/service';

/**
 * TanStack Query hooks over the in-memory seeded mock source (ADR-003).
 *
 * These give the wizard idiomatic data-fetching ergonomics (loading /
 * error / cached) with NO network — the source is local and deterministic.
 * Query keys are exactly as ADR-003 fixes them so cache behaviour is
 * predictable: `['services']`, `['barbers']`,
 * `['availability', barberId, serviceId, date]`.
 *
 * Centralising the keys here keeps the wizard, prefetching, and any
 * invalidation in one place.
 */
export const bookingQueryKeys = {
  services: ['services'] as const,
  barbers: ['barbers'] as const,
  availability: ({ barberId, serviceId, date }: AvailabilityRequest) =>
    ['availability', barberId, serviceId, date] as const,
};

/** The full service menu. Query key `['services']`. */
export function useServices() {
  return useQuery<readonly Service[]>({
    queryKey: bookingQueryKeys.services,
    queryFn: fetchServices,
  });
}

/** The full barber roster. Query key `['barbers']`. */
export function useBarbers() {
  return useQuery<readonly Barber[]>({
    queryKey: bookingQueryKeys.barbers,
    queryFn: fetchBarbers,
  });
}

/**
 * A day's availability for a barber + service + date. Query key
 * `['availability', barberId, serviceId, date]`. Disabled until all three
 * inputs are present (the wizard only queries once a date is chosen).
 */
export function useAvailability(
  request: Partial<AvailabilityRequest>,
) {
  const enabled =
    typeof request.barberId === 'string' &&
    typeof request.serviceId === 'string' &&
    typeof request.date === 'string';

  return useQuery<AvailabilitySlot[]>({
    queryKey: enabled
      ? bookingQueryKeys.availability(request as AvailabilityRequest)
      : ['availability', 'idle'],
    queryFn: () => fetchAvailability(request as AvailabilityRequest),
    enabled,
  });
}
