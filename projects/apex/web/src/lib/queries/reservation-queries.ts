'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getDisabledRanges, getRangeAvailability } from '@/lib/availability';
import {
  EXTRAS,
  FLEET,
  LOCATIONS,
  getBookingsForVehicle,
} from '@/mocks';
import type { AvailabilityResult, DisabledRange } from '@/lib/schemas/availability';
import type { Extra } from '@/lib/schemas/extra';
import type { Location } from '@/lib/schemas/location';
import type { Vehicle } from '@/lib/schemas/vehicle';

/**
 * TanStack Query mock-fetch layer (ADR-003 / Task 5.5).
 *
 * Mock data is fetched through TanStack Query against the IN-MEMORY seeded
 * source (`src/mocks/*` + the pure `getRangeAvailability` / `getDisabledRanges`)
 * wrapped in async functions with a small deterministic artificial latency —
 * NOT `fetch`. So the loading/`isPending`/error ergonomics, the query keys, and
 * the cache behaviour are idiomatic while the source is local. There is NO
 * network in v1 (the GLB/renders are static assets; nothing streams).
 *
 * Query keys (ADR-003, verbatim):
 *   ['vehicles']
 *   ['vehicle', slug]
 *   ['locations']
 *   ['extras']
 *   ['availability', vehicleId, fromISODate, toISODate]
 *   ['disabled-ranges', vehicleId]
 */

/** A short, CONSTANT artificial latency so loading states feel real but stay
 *  deterministic (no jitter — screenshots/tests are reproducible). */
const MOCK_LATENCY_MS = 240;

function delay<T>(value: T, ms = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, ms);
  });
}

export function useVehicles(): UseQueryResult<readonly Vehicle[]> {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: () => delay(FLEET),
  });
}

export function useLocations(): UseQueryResult<readonly Location[]> {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => delay(LOCATIONS),
  });
}

export function useExtras(): UseQueryResult<readonly Extra[]> {
  return useQuery({
    queryKey: ['extras'],
    queryFn: () => delay(EXTRAS),
  });
}

/**
 * The disabled (booked/blackout) ranges for a vehicle, for the date-range
 * picker. Disabled until a vehicle is chosen.
 */
export function useDisabledRanges(
  vehicleId: string | undefined,
): UseQueryResult<DisabledRange[]> {
  return useQuery({
    queryKey: ['disabled-ranges', vehicleId],
    enabled: Boolean(vehicleId),
    queryFn: () => {
      // `enabled` gates this on a defined `vehicleId`; the guard narrows the
      // type soundly (and would only throw if the query ran without one).
      if (vehicleId === undefined) {
        throw new Error('useDisabledRanges queryFn ran without a vehicleId');
      }
      return delay(
        getDisabledRanges(vehicleId, getBookingsForVehicle(vehicleId)),
      );
    },
  });
}

/**
 * The availability result for a specific requested range — drives the "this
 * range is available / unavailable (because …)" affordance with an accessible,
 * specific reason. Disabled until a vehicle + a complete range exist.
 */
export function useRangeAvailability(args: {
  vehicleId: string | undefined;
  fromISODate: string | undefined;
  toISODate: string | undefined;
}): UseQueryResult<AvailabilityResult> {
  const { vehicleId, fromISODate, toISODate } = args;
  const ready = Boolean(vehicleId && fromISODate && toISODate);
  return useQuery({
    queryKey: ['availability', vehicleId, fromISODate, toISODate],
    enabled: ready,
    queryFn: () => {
      // `enabled: ready` gates this on all three being defined; the guard
      // narrows them soundly (and only throws if the query ran prematurely).
      if (
        vehicleId === undefined ||
        fromISODate === undefined ||
        toISODate === undefined
      ) {
        throw new Error('useRangeAvailability queryFn ran without a complete range');
      }
      return delay(
        getRangeAvailability(
          {
            vehicleId,
            fromISODate,
            toISODate,
          },
          getBookingsForVehicle(vehicleId),
        ),
      );
    },
  });
}
