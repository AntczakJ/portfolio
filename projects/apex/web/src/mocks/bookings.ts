import {
  vehicleBookingListSchema,
  type VehicleBooking,
} from '@/lib/schemas/vehicle-booking';

import { SEED_BOOKINGS } from './seed-data';

/**
 * Seeded pre-bookings / blackouts mock accessor (Task 3.2).
 *
 * The source for `getRangeAvailability` + `getDisabledRanges` (Task 3.3).
 * Deterministic from the bake seed, so availability is stable across reloads.
 */
export const BOOKINGS: readonly VehicleBooking[] =
  vehicleBookingListSchema.parse(SEED_BOOKINGS);

/** All seeded bookings for one vehicle. */
export function getBookingsForVehicle(
  vehicleId: string,
): readonly VehicleBooking[] {
  return BOOKINGS.filter((b) => b.vehicleId === vehicleId);
}
