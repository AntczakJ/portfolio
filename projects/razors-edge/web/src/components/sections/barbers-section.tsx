import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatCategory } from '@/lib/format';
import type { Barber } from '@/lib/schemas/barber';
import { BARBERS } from '@/mocks';

import { RevealGroup } from './reveal-group';
import { SectionHeading } from './section-heading';

/**
 * Team / barbers (Task 4.3) — a card per barber from the mock: graded
 * portrait, name, handle, title, specialties, and a "Book with <name>"
 * affordance deep-linking to `/book?barber=<id>` (Phase 4b reads it to
 * preselect the barber).
 *
 * Portraits are real, royalty-clear (Unsplash License) men's headshots
 * graded to the dark-luxe world (no gray placeholders) — `next/image` AVIF,
 * sized, with blur placeholders, lazy (below the fold, so the hero keeps the
 * LCP). The brass lit-edge motif recurs as the card hover.
 *
 * Server Component — `BARBERS` is static seeded data (real DOM for SEO /
 * SR). The scroll-reveal is the client `RevealGroup`; the hover is CSS.
 */
export function BarbersSection(): ReactNode {
  return (
    <section
      id="barbers"
      aria-labelledby="barbers-heading"
      className="relative mx-auto max-w-[80rem] scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32"
    >
      <RevealGroup className="contents">
        <SectionHeading
          id="barbers-heading"
          eyebrow="The team"
          title="The hands behind the work."
          lead="A small, deliberate roster. Each chair has a specialism — book the barber whose craft fits the cut you want."
        />

        <ul className="mt-16 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 sm:mt-20 lg:grid-cols-3">
          {BARBERS.map((barber) => (
            <li key={barber.id} data-reveal>
              <BarberCard barber={barber} />
            </li>
          ))}
        </ul>
      </RevealGroup>
    </section>
  );
}

/**
 * One barber card: portrait over name + handle + title, the specialties as
 * brass-edged tags, and a "Book with <first name>" link into the wizard
 * pre-seeded with this barber. The whole portrait + name block is the link
 * target; the brass honed-edge line grows under the name on hover/focus.
 */
function BarberCard({ barber }: { barber: Barber }): ReactNode {
  const firstName = barber.name.split(' ')[0];

  return (
    <Link
      href={`/book?barber=${barber.id}`}
      aria-label={`Book with ${barber.name}, ${barber.title}`}
      className="group focus-visible:ring-ring block rounded-sm focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none"
    >
      <div
        className="border-border/70 relative w-full overflow-hidden rounded-sm border"
        style={{ aspectRatio: String(barber.portrait.aspectRatio) }}
      >
        <Image
          src={barber.portrait.src}
          alt={barber.portrait.alt}
          fill
          sizes="(min-width: 1024px) 24rem, (min-width: 640px) 45vw, 100vw"
          placeholder="blur"
          blurDataURL={barber.portrait.blurDataURL}
          className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
        />
        {/* Bottom vignette for legibility under the overlaid name. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
        />
        {/* Handle, overlaid bottom-left. */}
        <span className="absolute bottom-3 left-4 text-xs tracking-wide text-white/75">
          {barber.handle}
        </span>
      </div>

      <div className="relative mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-fg text-[length:var(--text-h3)] [font-variation-settings:'opsz'_72,'wght'_500,'SOFT'_0]">
            {barber.name}
          </h3>
          <span
            aria-hidden="true"
            className="text-brass-text shrink-0 translate-x-1 text-sm opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          >
            Book with {firstName}
          </span>
        </div>
        {/* Brass honed-edge line under the name. */}
        <span
          aria-hidden="true"
          className="mt-2 block h-px w-full origin-left scale-x-0 bg-[var(--color-edge-glow)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100 group-focus-visible:scale-x-100"
        />
        <p className="text-fg-muted mt-3 text-sm">{barber.title}</p>

        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Specialties">
          {barber.specialties.map((category) => (
            <li
              key={category}
              className="border-border text-fg-subtle rounded-full border px-2.5 py-0.5 text-[0.6875rem] tracking-[0.08em] uppercase"
            >
              {formatCategory(category)}
            </li>
          ))}
        </ul>

        <p className="text-fg-subtle mt-4 max-w-[34ch] text-balance text-sm leading-relaxed">
          {barber.bio}
        </p>
      </div>
    </Link>
  );
}
