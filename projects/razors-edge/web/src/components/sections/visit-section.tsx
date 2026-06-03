import { ArrowUpRight, Mail, MapPin, Phone } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

import {
  FacebookGlyph,
  InstagramGlyph,
  TikTokGlyph,
} from '@/components/chrome/brand-icons';
import { todayISODate, weekdayOfISODate } from '@/lib/clock';
import { cn } from '@/lib/cn';
import { minutesToHHMM, hhmmToMinutes } from '@/lib/schemas/common';
import { SHOP } from '@/mocks';

import { RevealGroup } from './reveal-group';
import { SectionHeading } from './section-heading';
import { StudioMap } from './studio-map';

/**
 * Visit (Task 4.4) — opening hours (today highlighted via the frozen clock),
 * address, contact, socials, and a CSP-clean static map treatment.
 *
 * "Today" is derived from the frozen `now` (ADR-003) — `weekdayOfISODate`
 * of `todayISODate()` — so the highlighted row is deterministic across
 * reloads / screenshots / tests (frozen now = Wed 2026-06-10). The map is an
 * inline SVG motif (`StudioMap`), same-origin, no external map JS / API key,
 * with an "Open in Maps" click-through to the real maps URL.
 *
 * Server Component — all data is static (`SHOP`) + the frozen clock; real
 * DOM for SEO (and the source of the `HairSalon` JSON-LD, Phase 7). The
 * scroll-reveal is the client `RevealGroup`.
 */
const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function formatWindow(open: string, close: string): string {
  return `${minutesToHHMM(hhmmToMinutes(open))} – ${minutesToHHMM(hhmmToMinutes(close))}`;
}

export function VisitSection(): ReactNode {
  const todayWeekday = weekdayOfISODate(todayISODate());

  return (
    <section
      id="visit"
      aria-labelledby="visit-heading"
      className="relative mx-auto max-w-[80rem] scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32"
    >
      <RevealGroup className="contents">
        <SectionHeading
          id="visit-heading"
          eyebrow="Find us"
          title="Próżna 12, Warsaw."
          lead="A quiet corner of the old town. By appointment — the chair is yours for the hour you book."
        />

        <div className="mt-16 grid grid-cols-1 gap-10 sm:mt-20 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          {/* Hours + contact. */}
          <div data-reveal className="flex flex-col gap-10">
            <div>
              <h3 className="text-fg-subtle text-[length:var(--text-caption)] tracking-[0.2em] uppercase">
                Opening hours
              </h3>
              <dl className="mt-5 grid grid-cols-[1fr_auto]">
                {SHOP.openingHours.map((row, weekday) => {
                  const isToday = weekday === todayWeekday;
                  return (
                    // dt/dd are direct grid children of the <dl> (valid
                    // definition-list structure); the per-row border + layout
                    // are expressed with the grid + col-spanning, not a
                    // wrapping <div>.
                    <Fragment key={weekday}>
                      <dt
                        className={cn(
                          'border-border col-start-1 flex items-center gap-2.5 border-b py-3 text-[length:var(--text-body)]',
                          isToday
                            ? 'border-brass-muted/40 text-fg'
                            : 'text-fg-muted',
                        )}
                      >
                        {isToday ? (
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full bg-[var(--color-edge-glow)]"
                          />
                        ) : (
                          <span aria-hidden="true" className="h-1.5 w-1.5" />
                        )}
                        {WEEKDAY_LABELS[weekday]}
                        {isToday ? (
                          <span className="text-brass-text text-[0.625rem] tracking-[0.18em] uppercase">
                            Today
                          </span>
                        ) : null}
                      </dt>
                      <dd
                        className={cn(
                          'border-border col-start-2 flex items-center justify-end border-b py-3 text-[length:var(--text-body)] tabular-nums',
                          isToday
                            ? 'border-brass-muted/40'
                            : '',
                          row === null
                            ? 'text-fg-subtle'
                            : isToday
                              ? 'text-fg'
                              : 'text-fg-muted',
                        )}
                      >
                        {row === null
                          ? 'Closed'
                          : formatWindow(row.open, row.close)}
                      </dd>
                    </Fragment>
                  );
                })}
              </dl>
            </div>

            <div>
              <h3 className="text-fg-subtle text-[length:var(--text-caption)] tracking-[0.2em] uppercase">
                Get in touch
              </h3>
              <ul className="mt-5 flex flex-col gap-3">
                <li>
                  <a
                    href={`tel:${SHOP.phone.replace(/\s/g, '')}`}
                    className="group focus-visible:ring-ring text-fg-muted hover:text-fg flex items-center gap-3 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Phone className="text-brass-text size-4 shrink-0" />
                    {SHOP.phone}
                  </a>
                </li>
                <li>
                  <a
                    href={`mailto:${SHOP.email}`}
                    className="group focus-visible:ring-ring text-fg-muted hover:text-fg flex items-center gap-3 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Mail className="text-brass-text size-4 shrink-0" />
                    {SHOP.email}
                  </a>
                </li>
                <li className="text-fg-muted flex items-start gap-3">
                  <MapPin className="text-brass-text mt-0.5 size-4 shrink-0" />
                  <span>
                    {SHOP.address.street}
                    <br />
                    {SHOP.address.postalCode} {SHOP.address.city},{' '}
                    {SHOP.address.country}
                  </span>
                </li>
              </ul>

              <ul className="mt-6 flex items-center gap-2">
                {SHOP.socials.map((social) => {
                  const Icon =
                    social.platform === 'instagram'
                      ? InstagramGlyph
                      : social.platform === 'facebook'
                        ? FacebookGlyph
                        : social.platform === 'tiktok'
                          ? TikTokGlyph
                          : null;
                  if (!Icon) return null;
                  return (
                    <li key={social.platform}>
                      <a
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${SHOP.name} on ${social.platform}`}
                        className="group text-fg-muted hover:text-brass-text focus-visible:ring-ring border-border bg-surface/30 hover:border-border-strong relative flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <Icon className="size-[1.05rem]" />
                        {/* Brand drawn-edge under-line on hover (D-12). */}
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 bottom-0 h-px origin-center scale-x-0 bg-[var(--color-edge-glow)] transition-transform duration-300 group-hover:scale-x-100"
                        />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Map treatment + click-through. */}
          <div data-reveal className="flex flex-col">
            <figure className="border-border/70 relative aspect-[4/3] w-full overflow-hidden rounded-sm border lg:aspect-auto lg:flex-1">
              <StudioMap
                label={`Illustrated map showing Razor's Edge at ${SHOP.address.street}, ${SHOP.address.city}`}
              />
              {/* Grain-consistent edge vignette to seat the map in the page. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-sm shadow-[inset_0_0_60px_20px_var(--color-bg)]"
              />
            </figure>
            <a
              href={SHOP.address.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group focus-visible:ring-ring text-fg hover:text-brass-text mt-4 inline-flex items-center gap-2 self-start rounded-sm text-sm tracking-wide transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              Open in Maps
              <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </div>
        </div>
      </RevealGroup>
    </section>
  );
}
