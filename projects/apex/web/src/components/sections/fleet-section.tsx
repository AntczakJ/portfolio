import Link from 'next/link';
import { ArrowUpRight, Gauge, Route, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { TrackLine } from '@/components/chrome/track-line';
import { DEFAULT_CONFIG } from '@/mocks';
import { formatDailyPrice } from '@/lib/format';
import { RESERVE_HREF } from '@/lib/site-nav';
import type { Vehicle } from '@/lib/schemas/vehicle';
import { FLEET } from '@/mocks';

import { Reveal } from './reveal';
import { ThemedImage } from './themed-image';

/**
 * Fleet section (Task 5.1) — the wider range, as an editorial list.
 *
 * A SERVER component over the seeded mock `FLEET` (the no-JS / SEO floor reads
 * completely): each vehicle shows its tier eyebrow, name + tagline, three spec
 * highlights (range / 0-100 / seats), the daily price (formatted from the
 * schema's minor units), and a "Reserve this" action that DEEP-LINKS into the
 * reservation flow PRE-SEEDED (`/reserve?vehicle=<slug>`). The configurable hero
 * (the Lumen SUV) additionally carries `&color=&wheels=` (its default config) so
 * the spine thread is seeded even when entering from the card rather than the
 * configurator — reusing the SAME deep-link contract the configurator's CTA and
 * the Phase-4 reservation store already implement (`seedFromDeepLink`).
 *
 * Each row is an editorial split (image / copy) with the track-line reveal motif
 * on entry (the `Reveal` GSAP scroll-reveal; reduced-motion -> static). The
 * configurable car leads (it is the flagship + the configurator entry point).
 *
 * The image is theme-aware (`ThemedImage`): the configurable SUV uses the real
 * GLB studio frames (`/renders/lumen-gt/hero{,-dark}.avif`); the rest use the
 * generated on-brand fleet renders (`/renders/<slug>/hero{,-dark}.avif`).
 */
function tierLabel(tier: Vehicle['tier']): string {
  switch (tier) {
    case 'compact':
      return 'Compact';
    case 'sedan':
      return 'Sedan';
    case 'suv':
      return 'SUV';
    case 'performance':
      return 'Performance';
  }
}

function reserveHref(vehicle: Vehicle): string {
  const base = `${RESERVE_HREF}?vehicle=${vehicle.slug}`;
  if (!vehicle.configurable) return base;
  // Seed the spine thread (the default config) when entering from the flagship
  // card, mirroring the configurator's deep-link contract.
  return `${base}&color=${DEFAULT_CONFIG.colorId}&wheels=${DEFAULT_CONFIG.wheelId}`;
}

/** Compact spec rail (range / 0-100 / seats) — shared by both card sizes. */
function SpecRail({ vehicle }: { vehicle: Vehicle }): ReactNode {
  return (
    <dl className="grid grid-cols-3 gap-4 border-y border-[var(--color-border)] py-5">
      <div>
        <dt className="text-fg-subtle flex items-center gap-1.5 text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
          <Route className="size-3.5" aria-hidden="true" /> Range
        </dt>
        <dd className="text-foreground mt-1 text-[length:var(--text-lg)] font-semibold">
          {vehicle.rangeKm}
          <span className="text-fg-muted text-sm font-normal"> km</span>
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle flex items-center gap-1.5 text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
          <Gauge className="size-3.5" aria-hidden="true" /> 0-100
        </dt>
        <dd className="text-foreground mt-1 text-[length:var(--text-lg)] font-semibold">
          {vehicle.accel0to100.toFixed(1)}
          <span className="text-fg-muted text-sm font-normal"> s</span>
        </dd>
      </div>
      <div>
        <dt className="text-fg-subtle flex items-center gap-1.5 text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
          <Users className="size-3.5" aria-hidden="true" /> Seats
        </dt>
        <dd className="text-foreground mt-1 text-[length:var(--text-lg)] font-semibold">
          {vehicle.seats}
        </dd>
      </div>
    </dl>
  );
}

function ReserveCta({ vehicle }: { vehicle: Vehicle }): ReactNode {
  return (
    <Link
      href={reserveHref(vehicle)}
      className="group bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-11 items-center gap-1.5 rounded-md px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      aria-label={`Reserve the ${vehicle.name}`}
    >
      Reserve this
      <ArrowUpRight
        className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

export function FleetSection(): ReactNode {
  const flagship = FLEET.find((v) => v.configurable) ?? FLEET[0];
  if (!flagship) {
    throw new Error('FLEET is empty: no flagship vehicle to feature');
  }
  // The rest of the line-up, by descending daily price.
  const rest = FLEET.filter((v) => v.id !== flagship.id).sort(
    (a, b) => b.dailyPriceMinor - a.dailyPriceMinor,
  );

  return (
    <section
      id="fleet"
      aria-labelledby="fleet-heading"
      className="bg-background relative scroll-mt-[var(--header-height,4rem)]"
    >
      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-[var(--space-section,6rem)]">
        <Reveal className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            The fleet
          </p>
          <h2
            id="fleet-heading"
            className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance"
          >
            A line-up built for the way you travel
          </h2>
          <p className="text-fg-muted mt-4 text-[length:var(--text-lg)] text-balance">
            Five premium cars, prepared and ready on pick-up, priced by the day.
            Reserve any of them in a couple of minutes.
          </p>
        </Reveal>

        <TrackLine className="my-12" />

        {/* ---- FLAGSHIP: a larger, distinct editorial treatment (A-11) ------
            The configurable hero gets a full-bleed featured block — a bigger
            studio frame, the "Configurable" badge, and richer copy — so the
            hierarchy reads "this is the one you configure", not one of five
            equal rows. */}
        <Reveal
          as="article"
          className="border-border from-surface to-background relative grid items-center gap-8 overflow-hidden rounded-[var(--radius-2xl)] border bg-gradient-to-b shadow-[var(--shadow-studio)] lg:grid-cols-[1.25fr_1fr]"
        >
          <div className="relative aspect-[16/10] w-full overflow-hidden lg:aspect-auto lg:h-full lg:min-h-[26rem]">
            <ThemedImage
              lightSrc={flagship.heroRenderSrc}
              alt={`${flagship.name} — APEX studio render`}
              sizes="(min-width: 1024px) 56vw, 92vw"
              className="object-cover"
              priority={false}
            />
            <span className="bg-accent text-accent-contrast absolute top-4 left-4 inline-flex items-center rounded-full px-3 py-1 text-[length:var(--text-2xs)] font-medium tracking-[var(--tracking-wide)] uppercase">
              Configurable flagship
            </span>
          </div>

          <div className="p-6 sm:p-8 lg:pr-10">
            <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
              {tierLabel(flagship.tier)} · Build it your way
            </p>
            <h3 className="font-display text-foreground mt-2 text-[length:var(--text-3xl)] font-semibold tracking-[var(--tracking-tight)]">
              {flagship.name}
            </h3>
            <p className="text-fg-muted mt-3 max-w-md text-[length:var(--text-lg)] leading-[var(--leading-normal)] text-balance">
              {flagship.tagline}
            </p>

            <div className="mt-6">
              <SpecRail vehicle={flagship} />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
              <p className="text-foreground text-[length:var(--text-2xl)] font-semibold tracking-[var(--tracking-tight)]">
                {formatDailyPrice(flagship.dailyPriceMinor, flagship.currency)}
              </p>
              <div className="flex items-center gap-3">
                <a
                  href="#configurator"
                  className="border-border text-foreground hover:border-border-strong hover:bg-surface focus-visible:ring-ring inline-flex h-11 items-center rounded-md border px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  Configure
                </a>
                <ReserveCta vehicle={flagship} />
              </div>
            </div>
          </div>
        </Reveal>

        {/* ---- THE REST: one consistent card family (A-02) ------------------
            All four share the SAME studio treatment as the flagship frame
            (same aspect, cyclorama, contact shadow) — distinguished by
            segment/proportion, not a different art style. */}
        <Reveal
          stagger
          className="mt-10 grid gap-6 sm:grid-cols-2 sm:gap-8"
        >
          {rest.map((vehicle) => (
            <article
              key={vehicle.id}
              data-reveal-item
              className="border-border bg-surface group flex flex-col overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-card)]"
            >
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <ThemedImage
                  lightSrc={vehicle.heroRenderSrc}
                  alt={`${vehicle.name} — APEX studio render`}
                  sizes="(min-width: 640px) 44vw, 92vw"
                  className="object-cover"
                />
              </div>

              <div className="flex flex-1 flex-col p-6">
                <p className="text-fg-subtle text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
                  {tierLabel(vehicle.tier)}
                </p>
                <h3 className="font-display text-foreground mt-2 text-[length:var(--text-2xl)] font-semibold tracking-[var(--tracking-tight)]">
                  {vehicle.name}
                </h3>
                <p className="text-fg-muted mt-3 text-[length:var(--text-base)] leading-[var(--leading-normal)] text-balance">
                  {vehicle.tagline}
                </p>

                <div className="mt-5">
                  <SpecRail vehicle={vehicle} />
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                  <p className="text-foreground text-[length:var(--text-xl)] font-semibold tracking-[var(--tracking-tight)]">
                    {formatDailyPrice(vehicle.dailyPriceMinor, vehicle.currency)}
                  </p>
                  <ReserveCta vehicle={vehicle} />
                </div>
              </div>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
