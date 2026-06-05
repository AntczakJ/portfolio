import type { ConfirmedReservation } from '@/lib/schemas/reservation-draft';

/**
 * Hand-rolled `.ics` generation (Task 5.6 / ADR-003 — no `ics` dependency).
 *
 * Emits a minimal RFC-5545 VCALENDAR/VEVENT for the confirmed (mocked) rental,
 * as a string downloaded client-side via a `Blob` (CSP-clean: `img-src blob:`
 * covers the object URL; no inline/eval). The event is a MULTI-DAY ALL-DAY
 * VEVENT spanning the rental range:
 *
 *   DTSTART;VALUE=DATE = `from`  (inclusive)
 *   DTEND;VALUE=DATE   = `to`    (EXCLUSIVE per the iCalendar all-day
 *                                  convention — the half-open `[from, to)`
 *                                  range already matches this, so the rental's
 *                                  `toISODate` is written verbatim)
 *
 * Deterministic: every field derives from the `ConfirmedReservation` (which is
 * itself deterministic — the reference is a stable hash, the range is the frozen
 * draft), so the same reservation always produces byte-identical output
 * (reproducible for tests + screenshots). `DTSTAMP` is pinned to the range start
 * midnight (not "now") to keep output stable.
 */

/** Escape a TEXT value per RFC-5545 §3.3.11. */
function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      // Normalise CRLF, LF, AND a lone CR (P2-3) to the escaped `\n` so a bare
      // `\r` never survives into a content line (it would corrupt folding).
      .replace(/\r\n|\r|\n/g, '\\n')
  );
}

/**
 * Fold a content line to 75 octets (RFC-5545 §3.1) — continuation lines start
 * with a single space. Folds on character count, correct for the ASCII content
 * this generator emits.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

/** A `YYYY-MM-DD` calendar date as an ICS DATE value `YYYYMMDD`. */
function toIcsDate(dateIso: string): string {
  return dateIso.replace(/-/g, '');
}

/** A `YYYY-MM-DD` as a UTC midnight DATE-TIME stamp `YYYYMMDDT000000Z`. */
function toIcsDateTimeStamp(dateIso: string): string {
  return `${toIcsDate(dateIso)}T000000Z`;
}

/**
 * Build the full `.ics` document for a confirmed reservation. Pure +
 * deterministic given the (deterministic) confirmation.
 */
export function buildReservationIcs(
  reservation: ConfirmedReservation,
): string {
  const { range, reference } = reservation;

  const dtstart = toIcsDate(range.fromISODate);
  // All-day DTEND is EXCLUSIVE; the half-open `toISODate` is already the day
  // AFTER the last rental day, so it is written verbatim.
  const dtend = toIcsDate(range.toISODate);
  const dtstamp = toIcsDateTimeStamp(range.fromISODate);
  const uid = `${reference.toLowerCase()}@apex.demo`;

  const config =
    reservation.colorName && reservation.wheelName
      ? ` (${reservation.colorName} / ${reservation.wheelName})`
      : '';
  const summary = `APEX rental — ${reservation.vehicleName}${config}`;

  const descriptionLines = [
    `Reservation reference: ${reference}`,
    `Vehicle: ${reservation.vehicleName}${config}`,
    `Pick-up: ${reservation.pickupName}`,
    `Return: ${reservation.returnName}`,
    `Days: ${String(reservation.rentalDays)}`,
    'This is a demo reservation — no car was actually booked.',
  ];
  const description = descriptionLines.join('\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//APEX//Rental Demo//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `DTEND;VALUE=DATE:${dtend}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(reservation.pickupAddress)}`,
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF line endings (RFC-5545 §3.1) + 75-octet folding.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** A safe, deterministic filename for the download. */
export function reservationIcsFilename(
  reservation: ConfirmedReservation,
): string {
  return `apex-${reservation.reference.toLowerCase()}.ics`;
}

/**
 * Trigger a client-side download of the `.ics` for a confirmed reservation.
 * Browser-only (uses `Blob` + an object URL); guarded so it never runs in a
 * non-DOM environment. CSP-clean (no inline script, no eval — a Blob URL +
 * a synthetic anchor click).
 */
export function downloadReservationIcs(
  reservation: ConfirmedReservation,
): void {
  if (typeof document === 'undefined') return;
  const ics = buildReservationIcs(reservation);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = reservationIcsFilename(reservation);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the download has started.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
