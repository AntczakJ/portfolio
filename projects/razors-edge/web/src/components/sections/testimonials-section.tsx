import type { ReactNode } from 'react';

import { EdgeTick } from '@/components/chrome/edge-marks';
import { cn } from '@/lib/cn';
import type { Testimonial } from '@/lib/schemas/testimonial';
import { TESTIMONIALS } from '@/mocks';

import { RevealGroup } from './reveal-group';
import { SectionHeading } from './section-heading';

/**
 * Testimonials / reviews (Task 4.4) — the seeded client quotes, presented
 * editorially (PLAN.md: "not a star-rating dump", "not a generic
 * carousel-of-cards unless it earns it").
 *
 * Treatment: one featured lead quote set large in the Fraunces display
 * italic (a pull-quote, the way a print spread opens a reviews page), then
 * the remaining quotes in a restrained masonry-ish two/three-column flow.
 * The rating is conveyed accessibly (an `aria-label` + a small brass mark)
 * rather than a loud row of stars — luxe restraint over a generic widget.
 *
 * Server Component — `TESTIMONIALS` is static seeded data (real DOM); the
 * scroll-reveal is the client `RevealGroup`.
 */
export function TestimonialsSection(): ReactNode {
  const [lead, ...rest] = TESTIMONIALS;

  return (
    <section
      aria-labelledby="testimonials-heading"
      className="relative mx-auto max-w-[80rem] scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32"
    >
      <RevealGroup className="contents">
        <SectionHeading
          id="testimonials-heading"
          eyebrow="In their words"
          title="The chair earns its regulars."
        />

        {lead ? (
          <figure data-reveal className="mt-14 max-w-4xl sm:mt-16">
            <Rating rating={lead.rating} />
            <blockquote className="mt-5">
              <p className="font-display text-fg text-balance text-[length:var(--text-h2)] leading-[1.18] italic [font-variation-settings:'opsz'_120,'wght'_420,'SOFT'_0]">
                &ldquo;{lead.quote}&rdquo;
              </p>
            </blockquote>
            <figcaption className="text-fg-muted mt-5 flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className="h-px w-8 bg-[var(--color-edge-glow)]"
              />
              <span className="text-fg">{lead.author}</span>
              {lead.service ? (
                <span className="text-fg-subtle">· {lead.service}</span>
              ) : null}
            </figcaption>
          </figure>
        ) : null}

        <ul className="mt-16 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((testimonial) => (
            <li key={testimonial.id} data-reveal>
              <QuoteCard testimonial={testimonial} />
            </li>
          ))}
        </ul>
      </RevealGroup>
    </section>
  );
}

function QuoteCard({
  testimonial,
}: {
  testimonial: Testimonial;
}): ReactNode {
  return (
    <figure className="border-border flex h-full flex-col border-t pt-6">
      <Rating rating={testimonial.rating} />
      <blockquote className="mt-4 flex-1">
        <p className="text-fg text-balance leading-relaxed">
          &ldquo;{testimonial.quote}&rdquo;
        </p>
      </blockquote>
      <figcaption className="text-fg-muted mt-5 text-sm">
        <span className="text-fg">{testimonial.author}</span>
        {testimonial.service ? (
          <span className="text-fg-subtle"> · {testimonial.service}</span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Rating mark (D-11) — accessible via `aria-label`, shown as the brand's
 * drawn razor-edge ticks (the blade motif, not a generic strip) plus an
 * explicit "N/5" label so the rating reads unambiguously. Filled ticks are
 * the lit brass edge; the rest are a quiet border tone.
 */
function Rating({ rating }: { rating: number }): ReactNode {
  return (
    <div
      className="flex items-center gap-2"
      role="img"
      aria-label={`Rated ${String(rating)} out of 5`}
    >
      <span className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <EdgeTick
            key={i}
            className={cn(
              'size-3.5',
              i < rating ? 'text-fg' : 'text-fg-subtle/40',
            )}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        className="text-fg-subtle text-xs tabular-nums tracking-wide"
      >
        {rating}/5
      </span>
    </div>
  );
}
