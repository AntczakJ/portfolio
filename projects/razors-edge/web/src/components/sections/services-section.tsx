import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatCategory, formatDuration, formatPrice } from '@/lib/format';
import type { ServiceCategory } from '@/lib/schemas/common';
import type { Service } from '@/lib/schemas/service';
import { SERVICES } from '@/mocks';

import { RevealGroup } from './reveal-group';
import { SectionHeading } from './section-heading';

/**
 * Services + pricing (Phase 4.2 / Task 4.1) — the full menu as an editorial
 * list grouped by category (Cuts / Beard / Shave / Combinations), each row a
 * name + description + duration + price with a "Book" affordance that
 * deep-links to `/book?service=<id>` (Phase 4b reads it to preselect).
 *
 * Prices are formatted from `priceMinor` + currency, durations from
 * `durationMin` (the format helpers). Combos are clearly marked with a brass
 * tag. Each row carries the brass "lit edge" hover — a fine brass line that
 * grows along the bottom edge of the row on hover/focus (never through the
 * text), echoing the honed-blade motif.
 *
 * Server Component — `SERVICES` is static seeded data, so the menu is real
 * DOM (SEO / SR / no-JS). The scroll-reveal + hover are CSS / the client
 * `RevealGroup` leaf. The menu order is the curated mock order, grouped.
 */
const CATEGORY_ORDER: readonly ServiceCategory[] = [
  'cut',
  'beard',
  'shave',
  'combo',
];

function groupByCategory(
  services: readonly Service[],
): { category: ServiceCategory; items: Service[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: services.filter((s) => s.category === category),
  })).filter((g) => g.items.length > 0);
}

export function ServicesSection(): ReactNode {
  const groups = groupByCategory(SERVICES);

  return (
    <section
      id="services"
      aria-labelledby="services-heading"
      className="relative mx-auto max-w-[80rem] scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32"
    >
      <RevealGroup className="contents">
        <SectionHeading
          id="services-heading"
          eyebrow="The menu"
          title={
            <>
              Considered work, <br className="hidden sm:block" />
              priced plainly.
            </>
          }
          lead="Every chair includes a consultation and a finish. No upsell, no surprises — the price you see is the price you pay."
        />

        <div className="mt-16 flex flex-col gap-16 sm:mt-20">
          {groups.map((group) => (
            <div
              key={group.category}
              data-reveal
              className="grid gap-x-12 gap-y-6 lg:grid-cols-[14rem_1fr]"
            >
              <div className="lg:pt-2">
                <h3 className="font-display text-fg text-[length:var(--text-h3)] [font-variation-settings:'opsz'_72,'wght'_480,'SOFT'_0]">
                  {formatCategory(group.category)}
                </h3>
                <p className="text-fg-subtle mt-1 text-sm">
                  {group.items.length}{' '}
                  {group.items.length === 1 ? 'service' : 'services'}
                </p>
              </div>

              <ul className="border-border flex flex-col border-t">
                {group.items.map((service) => (
                  <li key={service.id}>
                    <ServiceRow service={service} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </RevealGroup>
    </section>
  );
}

/**
 * One menu row: name (+ popular / combo tags) and description on the left,
 * duration + price on the right, the whole row a link into the booking
 * wizard pre-seeded with this service. The brass lit-edge hover line grows
 * along the row's bottom on hover/focus.
 */
function ServiceRow({ service }: { service: Service }): ReactNode {
  return (
    <Link
      href={`/book?service=${service.id}`}
      aria-label={`Book ${service.name} — ${formatDuration(service.durationMin)}, ${formatPrice(service.priceMinor, service.currency)}`}
      className="group focus-visible:ring-ring border-border relative grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 border-b py-6 transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none sm:py-7"
    >
      {/* Brass honed-edge hover line, along the bottom of the row. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-[var(--color-edge-glow)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100 group-focus-visible:scale-x-100"
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-display text-fg text-[length:var(--text-body-lg)] [font-variation-settings:'opsz'_40,'wght'_500] transition-colors group-hover:text-[var(--color-brass-text)]">
            {service.name}
          </span>
          {service.category === 'combo' ? (
            <span className="border-brass-muted/60 text-brass-text rounded-full border px-2 py-0.5 text-[0.625rem] tracking-[0.18em] uppercase">
              Combo
            </span>
          ) : null}
          {service.popular ? (
            <span className="text-fg-subtle text-[0.625rem] tracking-[0.18em] uppercase">
              Most booked
            </span>
          ) : null}
        </div>
        <p className="text-fg-muted mt-1.5 max-w-md text-balance text-sm leading-relaxed">
          {service.description}
        </p>
      </div>

      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="text-fg text-[length:var(--text-body-lg)] tabular-nums">
          {formatPrice(service.priceMinor, service.currency)}
        </span>
        <span className="text-fg-subtle text-sm tabular-nums">
          {formatDuration(service.durationMin)}
        </span>
        <span
          aria-hidden="true"
          className="text-brass-text mt-1 inline-flex items-center gap-1 text-xs tracking-wide opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          Book
          <span className="block h-px w-4 bg-[var(--color-edge-glow)]" />
        </span>
      </div>
    </Link>
  );
}
