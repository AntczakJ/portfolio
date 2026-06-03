import { STUDIO_TIME_ZONE, STUDIO_UTC_OFFSET_MIN } from './clock';
import type { ConfirmedBooking } from './schemas/booking';

/**
 * Hand-rolled `.ics` generation (ADR-003 — no `ics` npm dependency).
 *
 * Emits a minimal RFC-5545 VCALENDAR/VEVENT for the confirmed (mocked)
 * appointment, as a string that downloads client-side via a `Blob`. The
 * event is deterministic: DTSTART/DTEND derive from the booking `date` +
 * `startMin` + `durationMin` against the FROZEN studio timezone offset, so
 * the same booking always produces byte-identical output (reproducible for
 * tests + screenshots).
 *
 * Design notes:
 *  - Times are written in UTC (`...Z`) computed from the studio-local
 *    wall-clock + the fixed `STUDIO_UTC_OFFSET_MIN`. UTC `Z` form is the
 *    most broadly compatible across calendar clients (no VTIMEZONE block
 *    needed, no ambiguity), which matters for a hand-rolled file.
 *  - Long TEXT values (SUMMARY/DESCRIPTION/LOCATION) are escaped per
 *    RFC-5545 (`\`, `;`, `,`, newlines) and folded at 75 octets.
 *  - `UID` is deterministic (derived from the reference) so re-downloading
 *    the same booking does not create a duplicate event in a calendar.
 */

/** Studio coordinates + address for the event LOCATION + GEO. */
interface IcsShopLocation {
  name: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface BuildIcsArgs {
  booking: ConfirmedBooking;
  location: IcsShopLocation;
}

/** Escape a TEXT value per RFC-5545 §3.3.11. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets (RFC-5545 §3.1) — continuation lines
 * start with a single space. We fold on character count, which is correct
 * for the ASCII content this generator emits.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

/** Format a Date as a UTC ICS timestamp: YYYYMMDDTHHMMSSZ. */
function toUtcStamp(instant: Date): string {
  const y = instant.getUTCFullYear();
  const mo = String(instant.getUTCMonth() + 1).padStart(2, '0');
  const d = String(instant.getUTCDate()).padStart(2, '0');
  const h = String(instant.getUTCHours()).padStart(2, '0');
  const mi = String(instant.getUTCMinutes()).padStart(2, '0');
  const s = String(instant.getUTCSeconds()).padStart(2, '0');
  return `${String(y)}${mo}${d}T${h}${mi}${s}Z`;
}

/**
 * Convert a studio-local (date, minute-of-day) to a UTC `Date` using the
 * fixed studio offset. `date` is YYYY-MM-DD; `minuteOfDay` is minutes from
 * studio-local midnight.
 */
export function studioLocalToUtc(date: string, minuteOfDay: number): Date {
  // Studio-local midnight expressed as a UTC instant, then add the
  // wall-clock minutes and subtract the studio offset to land on true UTC.
  const localMidnightUtcMs = new Date(`${date}T00:00:00Z`).getTime();
  const utcMs =
    localMidnightUtcMs +
    minuteOfDay * 60_000 -
    STUDIO_UTC_OFFSET_MIN * 60_000;
  return new Date(utcMs);
}

/**
 * Build the full `.ics` document string for a confirmed booking. Pure +
 * deterministic given the frozen clock offset.
 */
export function buildBookingIcs({ booking, location }: BuildIcsArgs): string {
  const start = studioLocalToUtc(booking.date, booking.startMin);
  const end = studioLocalToUtc(
    booking.date,
    booking.startMin + booking.durationMin,
  );

  // DTSTAMP is fixed to the event start (not "now") to keep output stable.
  const dtstamp = toUtcStamp(start);
  const uid = `${booking.reference.toLowerCase()}@razors-edge.demo`;

  const summary = `${booking.serviceName} with ${booking.barberName}`;
  const locationText = `${location.name}, ${location.street}, ${location.postalCode} ${location.city}, ${location.country}`;
  const description = [
    `Booking reference: ${booking.reference}`,
    `Service: ${booking.serviceName} (${String(booking.durationMin)} min)`,
    `Barber: ${booking.barberName}`,
    'This is a demo booking — no real appointment was scheduled.',
  ].join('\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Razor\'s Edge//Booking Demo//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(locationText)}`,
    `X-WR-TIMEZONE:${STUDIO_TIME_ZONE}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF line endings (RFC-5545 §3.1) + 75-octet folding.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** A safe, deterministic filename for the download. */
export function bookingIcsFilename(booking: ConfirmedBooking): string {
  return `razors-edge-${booking.reference.toLowerCase()}.ics`;
}

/**
 * Trigger a client-side download of the `.ics` for a confirmed booking.
 * Browser-only (uses `Blob` + an object URL); guarded so it never runs in
 * a non-DOM environment.
 */
export function downloadBookingIcs(args: BuildIcsArgs): void {
  if (typeof document === 'undefined') return;
  const ics = buildBookingIcs(args);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = bookingIcsFilename(args.booking);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the navigation has started.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
