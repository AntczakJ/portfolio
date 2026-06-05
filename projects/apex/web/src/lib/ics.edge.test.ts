import { describe, expect, it } from 'vitest';

import { buildReservationIcs, reservationIcsFilename } from './ics';
import type { ConfirmedReservation } from './schemas/reservation-draft';

/**
 * Phase 7 (Task 7.1) — exhaustive `.ics` edge coverage, filling the gaps:
 *   - RFC-5545 escaping of backslash, semicolon, comma, AND the lone `\r`
 *     (P2-3) / `\n` / `\r\n` normalisation in a TEXT value;
 *   - 75-octet line folding with a leading-space continuation;
 *   - a multi-day exclusive DTEND;
 *   - the config suffix omitted when colour/wheel names are absent
 *     (non-configurable vehicles);
 *   - the demo disclosure always present;
 *   - the filename derivation.
 *
 * Not duplicating the Phase-5 `ics.test.ts` sanity cases.
 */

function reservation(
  overrides: Partial<ConfirmedReservation> = {},
): ConfirmedReservation {
  return {
    reference: 'APX-ABCD-EFGH',
    vehicleName: 'APEX Lumen SUV',
    config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
    colorName: 'Voltaic',
    wheelName: 'Forged',
    range: { fromISODate: '2026-06-20', toISODate: '2026-06-27' },
    rentalDays: 7,
    pickupName: 'City Centre',
    pickupAddress: '1 Market St, London',
    returnName: 'Airport',
    extras: ['GPS'],
    insuranceTier: 'plus',
    quote: {
      base: 30000,
      extrasTotal: 1200,
      insuranceTotal: 8700,
      oneWayFee: 4900,
      discount: 0,
      total: 44800,
      currency: 'EUR',
      rentalDays: 7,
    },
    currency: 'EUR',
    isDemo: true,
    ...overrides,
  };
}

/** Split a folded ICS string back into logical lines (unfold leading spaces). */
function logicalLines(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('buildReservationIcs — multi-day all-day event', () => {
  it('writes DTSTART inclusive and DTEND exclusive over a 7-day rental', () => {
    const ics = buildReservationIcs(reservation());
    expect(ics).toContain('DTSTART;VALUE=DATE:20260620');
    // half-open `to` (2026-06-27) is written verbatim as the exclusive all-day end
    expect(ics).toContain('DTEND;VALUE=DATE:20260627');
  });

  it('pins DTSTAMP to the range start midnight (not wall-clock now) for byte stability', () => {
    const ics = buildReservationIcs(reservation());
    expect(ics).toContain('DTSTAMP:20260620T000000Z');
  });

  it('handles a single-night rental (from=D, to=D+1)', () => {
    const ics = buildReservationIcs(
      reservation({ range: { fromISODate: '2026-07-01', toISODate: '2026-07-02' }, rentalDays: 1 }),
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
    expect(ics).toContain('DTEND;VALUE=DATE:20260702');
  });
});

describe('buildReservationIcs — RFC-5545 TEXT escaping', () => {
  it('escapes backslash, semicolon, and comma', () => {
    const ics = buildReservationIcs(
      reservation({ pickupAddress: 'A;B,C\\D' }),
    );
    expect(ics).toContain('LOCATION:A\\;B\\,C\\\\D');
  });

  it('normalises a lone carriage return in a TEXT value to an escaped \\n (P2-3)', () => {
    const ics = buildReservationIcs(
      reservation({ pickupAddress: 'Line1\rLine2' }),
    );
    // A bare \r must NOT survive into a content line.
    expect(ics).not.toMatch(/LOCATION:[^\r]*\r(?!\n)/);
    expect(ics).toContain('LOCATION:Line1\\nLine2');
  });

  it('normalises CRLF and LF to an escaped \\n', () => {
    expect(
      buildReservationIcs(reservation({ pickupAddress: 'a\r\nb' })),
    ).toContain('LOCATION:a\\nb');
    expect(
      buildReservationIcs(reservation({ pickupAddress: 'a\nb' })),
    ).toContain('LOCATION:a\\nb');
  });
});

describe('buildReservationIcs — line folding', () => {
  it('folds content lines longer than 75 octets with a leading-space continuation', () => {
    const longName = 'A'.repeat(120);
    const ics = buildReservationIcs(reservation({ vehicleName: longName, colorName: undefined, wheelName: undefined }));
    // Every physical line ≤ 75 chars (folded ones included).
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the long SUMMARY value.
    const unfolded = logicalLines(ics).find((l) => l.startsWith('SUMMARY:'));
    expect(unfolded).toContain(longName);
  });
});

describe('buildReservationIcs — config suffix + demo disclosure', () => {
  it('omits the (colour / wheel) suffix for a non-configurable vehicle', () => {
    const ics = buildReservationIcs(
      reservation({ vehicleName: 'APEX Mira', colorName: undefined, wheelName: undefined, config: undefined }),
    );
    expect(ics).toContain('SUMMARY:APEX rental — APEX Mira');
    expect(ics).not.toMatch(/SUMMARY:.*\(/);
  });

  it('always includes the demo disclosure', () => {
    expect(buildReservationIcs(reservation())).toContain(
      'no car was actually booked',
    );
  });
});

describe('reservationIcsFilename', () => {
  it('derives a lowercase apex-<ref>.ics filename', () => {
    expect(reservationIcsFilename(reservation({ reference: 'APX-WXYZ-2345' }))).toBe(
      'apex-apx-wxyz-2345.ics',
    );
  });
});
