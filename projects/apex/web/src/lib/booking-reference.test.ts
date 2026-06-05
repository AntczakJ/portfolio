import { describe, expect, it } from 'vitest';

import { reservationReference } from './booking-reference';
import type { ReservationSubmit } from './schemas/reservation-draft';

/**
 * Sanity coverage for the deterministic reference (Task 5.6). The reference
 * must be stable for a given payload (screenshots) and differ for different
 * payloads (no collisions in practice).
 */

const BASE: ReservationSubmit = {
  vehicleId: 'veh-lumen-suv',
  config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
  range: { fromISODate: '2026-06-20', toISODate: '2026-06-23' },
  pickupLocationId: 'loc-city',
  returnLocationId: 'loc-airport',
  extras: ['ext-gps'],
  insuranceTier: 'plus',
  driver: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+44 20 7946 0000',
    licenceNo: 'LOVEL12345',
  },
};

describe('reservationReference', () => {
  it('matches the APX-XXXX-XXXX format over an unambiguous alphabet', () => {
    const ref = reservationReference(BASE);
    expect(ref).toMatch(/^APX-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });

  it('is deterministic for the same payload', () => {
    expect(reservationReference(BASE)).toBe(reservationReference(BASE));
  });

  it('is insensitive to extras ordering (sorted before hashing)', () => {
    const a = reservationReference({ ...BASE, extras: ['ext-gps', 'ext-seat'] });
    const b = reservationReference({ ...BASE, extras: ['ext-seat', 'ext-gps'] });
    expect(a).toBe(b);
  });

  it('changes when a load-bearing field changes', () => {
    const ref = reservationReference(BASE);
    expect(
      reservationReference({
        ...BASE,
        range: { fromISODate: '2026-07-01', toISODate: '2026-07-04' },
      }),
    ).not.toBe(ref);
    expect(
      reservationReference({
        ...BASE,
        driver: { ...BASE.driver, email: 'someone-else@example.com' },
      }),
    ).not.toBe(ref);
  });
});
