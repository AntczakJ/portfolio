import { describe, expect, it } from 'vitest';

import {
  buildReservationIcs,
  reservationIcsFilename,
} from './ics';
import type { ConfirmedReservation } from './schemas/reservation-draft';

/**
 * Sanity coverage for the hand-rolled `.ics` (Task 5.6). The exhaustive suite
 * is Phase 7; this guards the load-bearing all-day multi-day VEVENT contract.
 */

const RESERVATION: ConfirmedReservation = {
  reference: 'APX-ABCD-EFGH',
  vehicleName: 'APEX Lumen SUV',
  config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
  colorName: 'Voltaic',
  wheelName: 'Forged',
  range: { fromISODate: '2026-06-20', toISODate: '2026-06-23' },
  rentalDays: 3,
  pickupName: 'City Centre',
  pickupAddress: '1 Market St, London',
  returnName: 'Airport',
  extras: ['GPS', 'Child seat'],
  insuranceTier: 'plus',
  quote: {
    base: 30000,
    extrasTotal: 1200,
    insuranceTotal: 8700,
    oneWayFee: 4900,
    discount: 0,
    total: 44800,
    currency: 'EUR',
    rentalDays: 3,
  },
  currency: 'EUR',
  isDemo: true,
};

describe('buildReservationIcs', () => {
  const ics = buildReservationIcs(RESERVATION);

  it('emits a valid VCALENDAR/VEVENT envelope with CRLF endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('BEGIN:VEVENT\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('writes an all-day multi-day event with an EXCLUSIVE DTEND', () => {
    // from = 2026-06-20 (inclusive), to = 2026-06-23 (exclusive half-open),
    // so DTEND is written verbatim as the day after the last rental night.
    expect(ics).toContain('DTSTART;VALUE=DATE:20260620');
    expect(ics).toContain('DTEND;VALUE=DATE:20260623');
  });

  it('includes the reference, config, and demo disclosure', () => {
    expect(ics).toContain('APEX rental — APEX Lumen SUV (Voltaic / Forged)');
    expect(ics).toContain('Reservation reference: APX-ABCD-EFGH');
    expect(ics).toContain('no car was actually booked');
  });

  it('is deterministic (byte-stable for the same reservation)', () => {
    expect(buildReservationIcs(RESERVATION)).toBe(ics);
  });

  it('escapes commas in the LOCATION per RFC-5545', () => {
    expect(ics).toContain('LOCATION:1 Market St\\, London');
  });

  it('derives a safe lowercase filename', () => {
    expect(reservationIcsFilename(RESERVATION)).toBe('apex-apx-abcd-efgh.ics');
  });
});
