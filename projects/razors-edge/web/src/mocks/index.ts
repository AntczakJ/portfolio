/**
 * Mock data layer (ADR-003) — the in-memory seeded source the booking flow
 * reads through TanStack Query. There is NO network in v1: these are async
 * wrappers over frozen seeded data, with a small deterministic artificial
 * latency so loading / `isPending` ergonomics are real while the source is
 * local and reproducible.
 *
 * The pure synchronous data (SERVICES, BARBERS, ...) is exported for direct
 * import (server components, server action, tests); the async `fetch*`
 * wrappers below are what the client query hooks call.
 */
import { getAvailability } from '@/lib/availability';
import type { AvailabilitySlot } from '@/lib/schemas/availability';
import type { Barber } from '@/lib/schemas/barber';
import type { Service } from '@/lib/schemas/service';

import { BARBERS, getBarberById } from './barbers';
import { PRE_BOOKINGS } from './pre-bookings';
import { SERVICES, getServiceById } from './services';

export { SERVICES, getServiceById, getServiceBySlug } from './services';
export {
  BARBERS,
  getBarberById,
  getBarberBySlug,
  barbersForCategory,
} from './barbers';
export { PRE_BOOKINGS, preBookingsForBarber } from './pre-bookings';
export { TESTIMONIALS } from './testimonials';
export { SHOP } from './shop';
export {
  GALLERY_SLOTS,
  gallerySlotsByKind,
  HERO_DESKTOP,
  HERO_MOBILE,
  GALLERY_FRAMES,
  type GallerySlot,
} from './gallery';

/**
 * Fixed artificial latency (ms) so query loading states are exercised
 * exactly like a real request, while staying deterministic (a constant,
 * not a random jitter — reproducible for tests / screenshots).
 */
export const MOCK_LATENCY_MS = 220;

function delay<T>(value: T, ms = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, ms);
  });
}

/** Async source: the full service menu. Query key `['services']`. */
export function fetchServices(): Promise<readonly Service[]> {
  return delay(SERVICES);
}

/** Async source: the full barber roster. Query key `['barbers']`. */
export function fetchBarbers(): Promise<readonly Barber[]> {
  return delay(BARBERS);
}

export interface AvailabilityRequest {
  barberId: string;
  serviceId: string;
  date: string;
}

/**
 * Async source: a day's availability slots for a barber + service + date.
 * Query key `['availability', barberId, serviceId, date]`. Resolves the
 * service duration and the barber from the seeded source, then runs the
 * PURE `getAvailability` — no network, fully deterministic.
 *
 * Throws if the barber or service id is unknown so the query surfaces an
 * error state rather than silently returning an empty grid.
 */
export function fetchAvailability({
  barberId,
  serviceId,
  date,
}: AvailabilityRequest): Promise<AvailabilitySlot[]> {
  const barber = getBarberById(barberId);
  const service = getServiceById(serviceId);
  if (!barber) {
    return Promise.reject(new Error(`Unknown barber: ${barberId}`));
  }
  if (!service) {
    return Promise.reject(new Error(`Unknown service: ${serviceId}`));
  }
  const slots = getAvailability({
    barber,
    serviceDurationMin: service.durationMin,
    date,
    preBookings: PRE_BOOKINGS,
  });
  return delay(slots);
}
