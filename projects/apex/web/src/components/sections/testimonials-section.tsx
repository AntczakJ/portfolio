import { Headset, Sparkles, Star, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { TrackLine } from '@/components/chrome/track-line';
import { TESTIMONIALS } from '@/mocks';

import { Reveal } from './reveal';

/**
 * Testimonials / trust (Task 5.3).
 *
 * A SERVER component over the seeded `TESTIMONIALS`, presented with editorial
 * restraint (motif-consistent): a row of trust signals (insurance, support,
 * clean-car guarantee), then a masonry-ish grid of client quotes with star
 * ratings. Cards reveal on scroll (`Reveal`; reduced-motion -> static). Star
 * rating is conveyed both visually (filled/empty stars, decorative) and to
 * assistive tech (an `sr-only` "Rated N out of 5").
 */

interface TrustSignal {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}

const TRUST: readonly TrustSignal[] = [
  {
    icon: Headset,
    title: '24/7 roadside support',
    body: 'A real person on the line, any hour, anywhere on the route.',
  },
  {
    icon: Sparkles,
    title: 'Clean-car guarantee',
    body: 'Valeted and sanitised before every hand-over, or your day is free.',
  },
  {
    icon: Star,
    title: 'Transparent cover',
    body: 'Three clear insurance tiers and no fine-print excess surprises.',
  },
];

function Stars({ rating }: { rating: number }): ReactNode {
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={
            n <= rating
              ? 'fill-accent text-accent size-4'
              : 'text-border-strong size-4'
          }
        />
      ))}
    </div>
  );
}

export function TestimonialsSection(): ReactNode {
  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="bg-surface border-border relative scroll-mt-[var(--header-height,4rem)] border-y"
    >
      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-[var(--space-section,6rem)]">
        <Reveal className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            Trust
          </p>
          <h2
            id="testimonials-heading"
            className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance"
          >
            Drivers who came back
          </h2>
        </Reveal>

        {/* Trust signals. */}
        <Reveal stagger className="mt-10 grid gap-6 sm:grid-cols-3">
          {TRUST.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.title}
                data-reveal-item
                className="flex items-start gap-3"
              >
                <span className="text-accent-ink shrink-0">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-foreground text-[length:var(--text-base)] font-semibold">
                    {t.title}
                  </h3>
                  <p className="text-fg-muted mt-1 text-sm leading-[var(--leading-normal)]">
                    {t.body}
                  </p>
                </div>
              </div>
            );
          })}
        </Reveal>

        <TrackLine className="my-12" />

        {/* Quotes. */}
        <Reveal
          stagger
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.id}
              data-reveal-item
              className="border-border bg-background flex flex-col gap-4 rounded-[var(--radius-lg)] border p-6"
            >
              <Stars rating={t.rating} />
              <span className="sr-only">Rated {t.rating} out of 5.</span>
              <blockquote className="text-foreground text-[length:var(--text-base)] leading-[var(--leading-normal)] text-balance">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-auto">
                <p className="text-foreground text-sm font-medium">
                  {t.author}
                </p>
                <p className="text-fg-subtle text-[length:var(--text-xs)]">
                  {t.role}
                  {t.vehicle ? ` · ${t.vehicle}` : ''}
                </p>
              </figcaption>
            </figure>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
