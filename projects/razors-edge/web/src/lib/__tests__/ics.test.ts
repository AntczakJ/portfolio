import { describe, expect, it } from 'vitest';

import {
  buildBookingIcs,
  bookingIcsFilename,
  studioLocalToUtc,
} from '../ics';
import { bookingReference } from '../booking-reference';
import type { ConfirmedBooking } from '../schemas/booking';
import type { BookingSubmission } from '../schemas/booking';

/**
 * Unit suite for the hand-rolled `.ics` generation + the deterministic
 * booking reference (ADR-003 / Task 6.1). The `.ics` must be valid,
 * deterministic (same booking → byte-identical), and get the studio
 * timezone right (DTSTART/DTEND in UTC computed from the +02:00 studio
 * offset against the frozen clock).
 */

const SUBMISSION: BookingSubmission = {
  serviceId: 'svc-signature-cut',
  barberId: 'brb-marco',
  date: '2026-06-10',
  startMin: 10 * 60 + 30, // 10:30 studio-local
  contact: {
    name: 'Jan Antczak',
    email: 'jan@example.com',
    phone: '+48 600 100 200',
  },
};

const BOOKING: ConfirmedBooking = {
  reference: bookingReference(SUBMISSION),
  serviceId: SUBMISSION.serviceId,
  serviceName: 'Signature Cut',
  barberId: SUBMISSION.barberId,
  barberName: 'Marco Vidal',
  date: SUBMISSION.date,
  startMin: SUBMISSION.startMin,
  durationMin: 45,
  priceMinor: 16_000,
  currency: 'PLN',
  contact: SUBMISSION.contact,
  isDemo: true,
};

const LOCATION = {
  name: "Razor's Edge",
  street: 'ul. Próżna 12',
  city: 'Warsaw',
  postalCode: '00-107',
  country: 'Poland',
};

describe('bookingReference', () => {
  it('is deterministic for the same submission', () => {
    expect(bookingReference(SUBMISSION)).toBe(bookingReference(SUBMISSION));
  });

  it('matches the RE-XXXXXX shape', () => {
    expect(bookingReference(SUBMISSION)).toMatch(/^RE-[0-9A-Z]{6}$/);
  });

  it('differs when the submission differs', () => {
    const other = bookingReference({ ...SUBMISSION, startMin: 11 * 60 });
    expect(other).not.toBe(bookingReference(SUBMISSION));
  });
});

describe('studioLocalToUtc', () => {
  it('shifts studio-local (+02:00) back to UTC', () => {
    // 10:30 studio-local on 2026-06-10 = 08:30 UTC (offset +120 min).
    const utc = studioLocalToUtc('2026-06-10', 10 * 60 + 30);
    expect(utc.getUTCHours()).toBe(8);
    expect(utc.getUTCMinutes()).toBe(30);
    expect(utc.getUTCDate()).toBe(10);
  });
});

describe('buildBookingIcs', () => {
  const ics = buildBookingIcs({ booking: BOOKING, location: LOCATION });

  it('is a valid VCALENDAR/VEVENT envelope', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('uses CRLF line endings', () => {
    expect(ics).toContain('\r\n');
    // No bare LF without a preceding CR.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('writes DTSTART/DTEND in UTC from the studio offset', () => {
    // 10:30 +02:00 → 08:30Z; +45 min → 09:15Z.
    expect(ics).toContain('DTSTART:20260610T083000Z');
    expect(ics).toContain('DTEND:20260610T091500Z');
  });

  it('carries the reference + a deterministic UID', () => {
    expect(ics).toContain(`DESCRIPTION:Booking reference: ${BOOKING.reference}`);
    expect(ics).toContain(
      `UID:${BOOKING.reference.toLowerCase()}@razors-edge.demo`,
    );
  });

  it('escapes the LOCATION text (commas)', () => {
    // Commas in the address are RFC-escaped with a backslash.
    expect(ics).toContain('LOCATION:Razor\'s Edge\\, ul. Próżna 12\\,');
  });

  it('is deterministic (same booking → identical output)', () => {
    const again = buildBookingIcs({ booking: BOOKING, location: LOCATION });
    expect(again).toBe(ics);
  });

  it('names the file from the reference', () => {
    expect(bookingIcsFilename(BOOKING)).toBe(
      `razors-edge-${BOOKING.reference.toLowerCase()}.ics`,
    );
  });
});
