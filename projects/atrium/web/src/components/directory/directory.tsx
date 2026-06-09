import type { ReactNode } from 'react';

import { Threshold } from '@/components/atmosphere/threshold';
import { PROJECTS } from '@/data/projects';
import { DIRECTORY_SECTION_ID } from '@/lib/site-nav';

import { ProjectLinks } from './repo-affordance';

/**
 * The directory (arrival) — the calm, fully-legible index of all six projects
 * (Task 4.3). This is the load-bearing FLOOR for three things at once (ADR-003):
 * the no-cinema reachable index, the reduced-motion render target, and the no-JS
 * render target. Every one of the twelve outward links is present and reachable
 * here WITHOUT scrolling the cinema.
 *
 * SERVER component — all real DOM. The visual treatment is first-class (Linear /
 * Klim restraint: a tight ruled index, display type held as a specimen, the
 * signature-hue spine making the range visible row-to-row), but the content and
 * reachability are the point: the range statement up top, then six rows, each with
 * its category badge, pitch, stack, and both links (demo live; repo via the U2
 * seam). A viewer who skips the cinema still gets the whole range-and-craft thesis.
 *
 * The range statement is sourced from the root README "Philosophy" + the PROGRESS
 * composition tracker: "six showcases, four api-heavy across four distinct
 * backends — Elysia/Bun, Hono, NestJS, Fastify — plus two creative web-only
 * showcases; one quality bar."
 */
export function Directory(): ReactNode {
  return (
    <>
      <Threshold weight="major" />

      <section
        id={DIRECTORY_SECTION_ID}
        aria-labelledby="directory-heading"
        className="relative scroll-mt-24 px-6 py-24 sm:py-32"
      >
        <div className="mx-auto max-w-6xl">
          {/* The range statement — the no-cinema thesis. */}
          <header className="mb-16 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
            <div className="max-w-2xl">
              <p className="text-light-text mb-4 text-xs font-medium tracking-[0.18em] uppercase">
                The directory
              </p>
              <h2
                id="directory-heading"
                className="font-display text-h1 text-fg leading-[1.04] tracking-tight"
                style={{ fontVariationSettings: "'wght' var(--display-wght-bold)" }}
              >
                Six showcases,
                <br />
                one quality bar.
              </h2>
            </div>
            <p className="text-fg-muted max-w-xl text-base leading-relaxed text-balance sm:text-lg">
              Four api-heavy showcases across four distinct backends — Elysia on
              Bun, Hono, NestJS, and Fastify — plus two creative web-only pieces.
              Every project is production-grade: tested, accessible, themed, and
              deployed. Pick the one you want to inspect.
            </p>
          </header>

          {/* The ruled index — one row per project. A ruled list (Klim/Linear
              restraint) reads more like an architectural directory than a card
              grid, and keeps every link reachable in a tight vertical scan. */}
          <ul className="border-border border-t">
            {PROJECTS.map((project, index) => {
              const categoryLabel =
                project.category === 'api-heavy'
                  ? `api-heavy · ${project.backend ?? ''}`
                  : 'web-only (creative)';
              return (
                <li
                  key={project.slug}
                  className="border-border group relative border-b"
                  style={
                    {
                      '--bay': `var(${project.accentToken})`,
                      '--bay-text': `var(${project.accentToken}-text)`,
                    } as React.CSSProperties
                  }
                >
                  {/* The signature-hue spine — lights up on hover/focus-within,
                      making the range visible and the row feel alive. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 transition-transform duration-300 ease-out group-hover:scale-y-100 group-focus-within:scale-y-100"
                    style={{ backgroundColor: 'var(--bay)' }}
                  />

                  <div className="grid gap-x-8 gap-y-5 py-8 pl-5 sm:py-9 lg:grid-cols-[auto_1fr_auto] lg:items-start">
                    {/* Index + name + badge. */}
                    <div className="flex items-baseline gap-4 lg:w-64 lg:flex-col lg:items-start lg:gap-2">
                      <span
                        className="font-display text-sm tabular-nums"
                        style={{ color: 'var(--bay-text)' }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <h3
                        className="font-display text-h3 text-fg tracking-tight"
                        style={{
                          fontVariationSettings: "'wght' var(--display-wght-bold)",
                        }}
                      >
                        {project.name}
                      </h3>
                      <span
                        className="text-xs font-medium tracking-[0.1em] uppercase"
                        style={{ color: 'var(--bay-text)' }}
                      >
                        {categoryLabel}
                      </span>
                    </div>

                    {/* Pitch + stack. */}
                    <div className="max-w-xl">
                      <p className="text-fg-muted text-sm leading-relaxed text-balance sm:text-base">
                        {project.pitch}
                      </p>
                      <ul className="mt-4 flex flex-wrap gap-1.5">
                        {project.stack.slice(0, 5).map((chip) => (
                          <li
                            key={chip}
                            className="text-fg-subtle border-border rounded border px-2 py-0.5 text-[0.6875rem] font-medium"
                          >
                            {chip}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Both links. */}
                    <ProjectLinks
                      project={project}
                      className="lg:flex-col lg:items-stretch"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </>
  );
}
