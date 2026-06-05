import { locationListSchema, type Location } from '@/lib/schemas/location';

import { SEED_LOCATIONS } from './seed-data';

/** Locations mock accessor (Task 3.2). Parsed once through the shared schema. */
export const LOCATIONS: readonly Location[] = locationListSchema.parse(
  SEED_LOCATIONS,
);

/** Look up a location by id (pickup/return selectors, JSON-LD). */
export function getLocationById(id: string): Location | undefined {
  return LOCATIONS.find((l) => l.id === id);
}
