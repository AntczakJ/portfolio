import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface SectionHeadingProps {
  /** Brass eyebrow label (kicker). */
  eyebrow: string;
  /** The section title. */
  title: ReactNode;
  /** Optional supporting line under the title. */
  lead?: ReactNode;
  /** `h2` id for `aria-labelledby` wiring. */
  id: string;
  className?: string;
  /** Centre the heading block (default left). */
  align?: 'left' | 'center';
}

/**
 * Shared section heading (Phase 4) — a brass "lit edge" eyebrow over a
 * Fraunces display title, with an optional lead line. Reused across the
 * Services / Gallery / Barbers / Testimonials / Visit sections so the
 * editorial rhythm reads as one design. The eyebrow rule is a brass edge,
 * never run through text (the designer-critic's brass-on-an-edge rule).
 *
 * The eyebrow + title + lead are each `data-reveal` so they participate in
 * the section's scroll-reveal when wrapped in a `RevealGroup`.
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  className,
  align = 'left',
}: SectionHeadingProps): ReactNode {
  return (
    <div
      className={cn(
        'max-w-2xl',
        align === 'center' && 'mx-auto text-center',
        className,
      )}
    >
      <p
        data-reveal
        className={cn(
          'text-brass-text flex items-center gap-3 text-[length:var(--text-caption)] tracking-[0.32em] uppercase',
          align === 'center' && 'justify-center',
        )}
      >
        <span
          aria-hidden="true"
          className="h-px w-8 bg-[var(--color-edge-glow)]"
        />
        {eyebrow}
      </p>
      <h2
        id={id}
        data-reveal
        className="font-display text-fg mt-5 text-balance text-[length:var(--text-h1)] leading-[1.05] [font-variation-settings:'opsz'_120,'wght'_440,'SOFT'_0]"
      >
        {title}
      </h2>
      {lead ? (
        <p
          data-reveal
          className="text-fg-muted mt-5 text-balance text-[length:var(--text-body-lg)] leading-relaxed"
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}
