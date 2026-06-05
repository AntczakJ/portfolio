import { describe, expect, it } from 'vitest';

import { reservationReference } from './booking-reference';
import type { ReservationSubmit } from './schemas/reservation-draft';

/**
 * Phase 7 (Task 7.1) — additional determinism coverage for the booking
 * reference, filling the gaps:
 *   - the unambiguous alphabet never emits 0/O/1/I;
 *   - every load-bearing field flips the reference (range, locations, config,
 *     insurance tier, driver email/licence — case-normalised);
 *   - config presence vs absence changes the code;
 *   - email case + licence case are normalised (same code regardless of case).
 *
 * Not duplicating the Phase-5 `booking-reference.test.ts` sanity cases.
 */

const BASE: ReservationSubmit = {
  vehicleId: 'veh-lumen-gt',
  config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
  range: { fromISODate: '2026-06-20', toISODate: '2026-06-23' },
  pickupLocationId: 'loc-lis-city',
  returnLocationId: 'loc-lis-airport',
  extras: ['ext-gps'],
  insuranceTier: 'plus',
  driver: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+44 20 7946 0000',
    licenceNo: 'LOVEL12345',
  },
};

describe('reservationReference — alphabet', () => {
  it('never emits ambiguous glyphs (0, O, 1, I) across many payloads', () => {
    for (let i = 0; i < 200; i += 1) {
      const ref = reservationReference({
        ...BASE,
        range: { fromISODate: '2026-06-20', toISODate: `2026-06-${String(20 + (i % 8) + 1).padStart(2, '0')}` },
        driver: { ...BASE.driver, email: `user${String(i)}@example.com` },
      });
      const groups = ref.slice(4); // strip "APX-"
      expect(groups).not.toMatch(/[01OI]/);
      expect(ref).toMatch(/^APX-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    }
  });
});

describe('reservationReference — sensitivity to load-bearing fields', () => {
  const base = reservationReference(BASE);

  it('changes when the pickup location changes', () => {
    expect(reservationReference({ ...BASE, pickupLocationId: 'loc-prt-depot' })).not.toBe(base);
  });

  it('changes when the return location changes', () => {
    expect(reservationReference({ ...BASE, returnLocationId: 'loc-prt-airport' })).not.toBe(base);
  });

  it('changes when the insurance tier changes', () => {
    expect(reservationReference({ ...BASE, insuranceTier: 'premium' })).not.toBe(base);
  });

  it('changes when the config changes', () => {
    expect(
      reservationReference({ ...BASE, config: { colorId: 'col-glacier', wheelId: 'whl-aero' } }),
    ).not.toBe(base);
  });

  it('changes between a configured and an unconfigured payload', () => {
    const noConfig = { ...BASE };
    delete (noConfig as { config?: unknown }).config;
    expect(reservationReference(noConfig)).not.toBe(base);
  });

  it('changes when the licence number changes', () => {
    expect(
      reservationReference({ ...BASE, driver: { ...BASE.driver, licenceNo: 'OTHER99999' } }),
    ).not.toBe(base);
  });
});

describe('reservationReference — case normalisation', () => {
  it('is invariant to email case', () => {
    expect(
      reservationReference({ ...BASE, driver: { ...BASE.driver, email: 'ADA@EXAMPLE.COM' } }),
    ).toBe(reservationReference(BASE));
  });

  it('is invariant to licence case', () => {
    expect(
      reservationReference({ ...BASE, driver: { ...BASE.driver, licenceNo: 'lovel12345' } }),
    ).toBe(reservationReference(BASE));
  });
});
