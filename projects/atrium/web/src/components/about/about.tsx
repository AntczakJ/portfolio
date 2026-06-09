import { ArrowUpRight, Mail } from 'lucide-react';
import type { ReactNode } from 'react';

import { Threshold } from '@/components/atmosphere/threshold';
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  GITHUB_BASE,
  REPO_LINKS_LIVE,
} from '@/lib/site-config';
import { ABOUT_SECTION_ID, DIRECTORY_SECTION_ID } from '@/lib/site-nav';

/**
 * About / author + contact (PLAN IA item 5, Task 4.4) — a tight statement of who
 * this is and the portfolio philosophy in the author's voice ("polish over
 * breadth; variance is the point; quality is non-negotiable" — root README), the
 * author name + contact (`mailto:`), and the profile link on the single
 * `GITHUB_BASE` seam (a live `<a>` once `REPO_LINKS_LIVE`, the U2 disabled control
 * until then — ADR-003), plus a final "explore" affordance back to the directory.
 *
 * SERVER component — every word and link is real DOM, present with JS disabled.
 * The three convictions are pulled out as a specimen list so the philosophy reads
 * as a stated standard, not a paragraph to skim.
 */

const CONVICTIONS = [
  {
    label: 'Polish over breadth',
    body: 'Six showcases taken to production quality, not a dozen demos left at 80 percent. Every project is tested, accessible, themed, and deployed.',
  },
  {
    label: 'Variance is the point',
    body: 'A different backend, a different motion language, and a different visual identity per project — deliberately, so the range is visible rather than asserted.',
  },
  {
    label: 'Quality is non-negotiable',
    body: 'One bar across all of it: WCAG 2.2 AA, Lighthouse 95-plus, Core Web Vitals green, both themes, mobile-first from 320 px.',
  },
] as const;

export function About(): ReactNode {
  return (
    <>
      <Threshold weight="minor" />

      <section
        id={ABOUT_SECTION_ID}
        aria-labelledby="about-heading"
        className="relative scroll-mt-24 px-6 py-24 sm:py-32"
      >
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
            {/* The statement. */}
            <div className="max-w-xl">
              <p className="text-light-text mb-4 text-xs font-medium tracking-[0.18em] uppercase">
                The author
              </p>
              <h2
                id="about-heading"
                className="font-display text-h1 text-fg leading-[1.06] tracking-tight"
                style={{ fontVariationSettings: "'wght' var(--display-wght-bold)" }}
              >
                One person, one quality bar, six showcases.
              </h2>
              <div className="text-fg-muted mt-7 flex flex-col gap-4 text-base leading-relaxed sm:text-lg">
                <p>
                  This portfolio is built on a single conviction: polish over
                  breadth, and variance is the point. Each showcase is a distinct
                  problem with a distinct stack, held to the same non-negotiable
                  standard of craft.
                </p>
                <p>
                  {AUTHOR_NAME} designs and builds the whole stack, from the
                  database schema to the scroll choreography. The front door you
                  are reading is project number seven.
                </p>
              </div>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <a
                  href={`mailto:${AUTHOR_EMAIL}`}
                  className="border-light/50 bg-light/10 text-light-strong hover:bg-light/20 hover:border-light inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors"
                >
                  <Mail aria-hidden className="size-4" />
                  Get in touch
                </a>

                {REPO_LINKS_LIVE ? (
                  <a
                    href={GITHUB_BASE}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${AUTHOR_NAME} on GitHub`}
                    className="border-border-strong text-fg-muted hover:text-fg hover:border-light/60 inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors"
                  >
                    GitHub profile
                    <ArrowUpRight aria-hidden className="size-4" />
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    title="Profile link available once the repository is published"
                    className="border-border text-fg-subtle inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-dashed px-4 py-2.5 text-sm font-medium opacity-70"
                  >
                    GitHub profile
                    <span className="sr-only">
                      — link available once the repository is published
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* The three convictions, as a specimen list. */}
            <ul className="border-border flex flex-col border-t lg:mt-2">
              {CONVICTIONS.map((conviction, index) => (
                <li
                  key={conviction.label}
                  className="border-border flex gap-5 border-b py-7"
                >
                  <span className="text-fg-subtle font-display pt-0.5 text-sm tabular-nums">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3
                      className="font-display text-h3 text-fg tracking-tight"
                      style={{
                        fontVariationSettings: "'wght' var(--display-wght)",
                      }}
                    >
                      {conviction.label}
                    </h3>
                    <p className="text-fg-muted mt-2 text-sm leading-relaxed text-balance sm:text-base">
                      {conviction.body}
                    </p>
                  </div>
                </li>
              ))}
              <li className="pt-7">
                <a
                  href={`#${DIRECTORY_SECTION_ID}`}
                  className="text-fg-muted hover:text-fg group inline-flex items-center gap-2 text-sm font-medium transition-colors"
                >
                  Back to the full directory
                  <ArrowUpRight
                    aria-hidden
                    className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
