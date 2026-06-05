import { ArrowUpRight, Clock, MapPin, Plane, Warehouse } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';

import { TrackLine } from '@/components/chrome/track-line';
import { LOCATIONS, SHOP } from '@/mocks';
import type { Location } from '@/lib/schemas/location';

import { BusinessJsonLd } from './business-jsonld';
import { Reveal } from './reveal';
import { ThemedImage } from './themed-image';

/**
 * Locations / pick-up points (Task 5.3) — the static-map treatment.
 *
 * A SERVER component over the seeded `LOCATIONS` (filtered to the shop's set).
 * Each location is a card with a STYLED STATIC MAP IMAGE (the generated
 * `/maps/<slug>{,-dark}.avif`, theme-aware, with a baked accent pin — NO live
 * map embed, per PLAN.md, to protect the performance budget), the address +
 * hours, and a maps CLICK-THROUGH link (a plain `https://maps` href, the only
 * interaction). The cards reveal on scroll (`Reveal`; reduced-motion -> static).
 *
 * The click-through uses a generic web-maps search URL built from the address +
 * city (no API key, no embed). It opens in a new tab.
 */

function kindIcon(
  kind: Location['kind'],
): ComponentType<SVGProps<SVGSVGElement>> {
  switch (kind) {
    case 'airport':
      return Plane;
    case 'depot':
      return Warehouse;
    case 'city':
      return MapPin;
  }
}

function mapsHref(loc: Location): string {
  const query = encodeURIComponent(`${loc.name}, ${loc.address}, ${loc.city}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function LocationsSection(): ReactNode {
  const locations = LOCATIONS.filter((loc) =>
    SHOP.locationIds.includes(loc.id),
  );

  return (
    <section
      id="locations"
      aria-labelledby="locations-heading"
      className="bg-background relative scroll-mt-[var(--header-height,4rem)]"
    >
      <BusinessJsonLd />
      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-[var(--space-section,6rem)]">
        <Reveal className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            Locations
          </p>
          <h2
            id="locations-heading"
            className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance"
          >
            Pick up where it suits you
          </h2>
          <p className="text-fg-muted mt-4 text-[length:var(--text-lg)] text-balance">
            Airport counters and city depots across Lisbon and Porto. Same-place
            or one-way returns are both fine.
          </p>
        </Reveal>

        <TrackLine className="my-12" />

        <Reveal stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {locations.map((loc) => {
            const Icon = kindIcon(loc.kind);
            const lightMap = loc.staticMapSrc;
            return (
              <article
                key={loc.id}
                data-reveal-item
                className="border-border bg-surface group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border shadow-[var(--shadow-card)]"
              >
                {/* Static map (theme-aware; accent pin baked in). */}
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <ThemedImage
                    lightSrc={lightMap}
                    alt={`Map showing the APEX ${loc.name} pick-up point in ${loc.city}`}
                    sizes="(min-width: 1024px) 22vw, (min-width: 640px) 44vw, 92vw"
                    fit="object-cover"
                  />
                  <span className="bg-surface/90 text-fg-muted absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[length:var(--text-2xs)] font-medium tracking-[var(--tracking-wide)] uppercase backdrop-blur-sm">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {loc.kind}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-5">
                  <h3 className="text-foreground text-[length:var(--text-lg)] font-semibold">
                    {loc.name}
                  </h3>
                  <p className="text-fg-muted text-sm leading-[var(--leading-normal)]">
                    {loc.address}
                    <br />
                    {loc.city}
                  </p>
                  <p className="text-fg-subtle flex items-center gap-1.5 text-sm">
                    <Clock className="size-3.5" aria-hidden="true" />
                    {loc.hours}
                  </p>
                  <a
                    href={mapsHref(loc)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent-ink hover:text-foreground focus-visible:ring-ring mt-auto inline-flex w-fit items-center gap-1 rounded-sm pt-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Open in Maps
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
              </article>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
