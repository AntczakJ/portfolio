import type { ReactNode } from 'react';

import { ProjectLinks } from '@/components/directory/repo-affordance';
import type { Project } from '@/lib/schemas/project';
import { bayId } from '@/lib/site-nav';

/**
 * The reusable project-bay component (Task 4.1) — one gallery "bay" rendered from
 * a single `Project` (the typed source of truth, `src/data/projects.ts`). It is
 * the spine of the six-bay tour: each bay carries its project's signature accent
 * hue (`accentToken`) so the scroll reads as a tour of differently-lit rooms
 * (ADR-003), the kinetic title resolves on lock-in, and the two unmissable
 * outward links settle into a fixed, discernible-named position.
 *
 * SERVER component / REAL DOM FLOOR. Everything here is server-rendered markup —
 * the title, the pitch, the stack ribbon, the badge, the wow-moment line, the two
 * links. That is deliberate (ADR-002/003): the bay is the no-JS / reduced-motion
 * floor — it reads complete and legible with GSAP never running. The Phase-4.2
 * sequence (`BaysSequence`) is the ONLY client wrapper; it pins this markup and
 * scrubs the title resolve via `data-bay-*` hooks. Without JS the bay sits at its
 * composed resting frame (the title legible, everything shown) — nothing is
 * created by the cinema, only enhanced.
 *
 * THE KINETIC TITLE (ADR-002, free GSAP core only — no Club plugin). The title is
 * REAL `<h2>` text in the DOM (sharp at every width, SEO/SR/no-JS complete). The
 * resolve is two layered real-text copies of the same string:
 *   - `data-bay-title-ghost` — the signature-hue "unresolved" copy, set heavier /
 *     wider and clipped, that the scrub WIPES away via `clip-path` as the bay
 *     locks in;
 *   - `data-bay-title-final` — the legible foreground title that resolves IN
 *     (a `font-variation-settings` weight/optical-size settle + a `clip-path`
 *     reveal from the hue).
 * Both are the same word, so a screen reader reads it once via the visible final
 * copy; the ghost is `aria-hidden`. Under reduced-motion / no-JS the final copy is
 * fully shown at rest and the ghost sits behind it — the composed frame.
 *
 * The `previewImage` slot (Task 4.5, optional/non-blocking) is OMITTED here by
 * design: the type-and-light composition is the v1 floor (ADR-003). When a still
 * is sourced it drops into the reserved `data-bay-media` column without reflowing
 * the type — but the bay reads complete without it.
 */

interface ProjectBayProps {
  project: Project;
  /** 1-based position in the tour, shown as the bay index (01 … 06). */
  index: number;
}

export function ProjectBay({ project, index }: ProjectBayProps): ReactNode {
  const ordinal = String(index).padStart(2, '0');
  const categoryLabel =
    project.category === 'api-heavy'
      ? `api-heavy · ${project.backend ?? ''}`
      : 'web-only (creative)';

  // Dynamic per-bay hue tokens => inline custom properties scoped to the bay, so
  // the markup below reads from `--bay`/`--bay-text`/`--bay-on` regardless of
  // which project this is (no per-project class explosion). Genuinely dynamic
  // (computed from data) — the one allowed inline-style case (conventions § 4).
  const hueVars = {
    '--bay': `var(${project.accentToken})`,
    '--bay-text': `var(${project.accentToken}-text)`,
    '--bay-on': `var(${project.accentToken}-on)`,
  } as React.CSSProperties;

  return (
    <section
      id={bayId(project.slug)}
      aria-labelledby={`${bayId(project.slug)}-title`}
      data-bay
      data-bay-slug={project.slug}
      style={hueVars}
      className="relative flex min-h-[100svh] scroll-mt-24 items-center overflow-hidden px-6 py-24 sm:py-28"
    >
      {/* THE BAY LIGHT-FIELD (D-04) — the hue does not trim the room, it LIGHTS
          it. Three token-driven layers make the bay's atmosphere carry the hue as
          illumination, so each bay reads as a distinctly-lit room on entry:
            1. a directional hue glow raking in from the top corner (the room's
               coloured light source — a clerestory tinted by the project);
            2. a hue-tinted shaft falling through the bay;
            3. a stronger hue floor pool the type stands in.
          All aria-hidden decoration; the scrub fades them up on lock-in. */}
      <div
        aria-hidden
        data-bay-wash
        className="pointer-events-none absolute inset-0 -z-0"
      >
        {/* 1 — directional coloured clerestory: the room's hue light source. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(72% 82% at 80% -10%, color-mix(in oklab, var(--bay) 38%, transparent), transparent 62%)',
          }}
        />
        {/* 2 — a soft hue shaft falling through the space. */}
        <div
          className="absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(42% 92% at 30% -12%, color-mix(in oklab, var(--bay) 26%, transparent), transparent 60%)',
          }}
        />
        {/* 3 — the hue floor the type stands in (stronger than the old wash). */}
        <div
          className="absolute inset-x-0 bottom-0 h-[64%]"
          style={{
            background:
              'radial-gradient(88% 100% at 50% 122%, color-mix(in oklab, var(--bay) 36%, transparent), transparent 72%)',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-x-14 gap-y-10 lg:grid-cols-[1.38fr_0.62fr] lg:items-center">
        {/* The type-and-light composition — the v1 floor (no preview dependency). */}
        <div className="flex flex-col items-start">
          {/* Bay index + the hue rule — the "room number" of the bay. */}
          <div
            data-bay-reveal
            className="mb-7 flex items-center gap-4 sm:mb-9"
          >
            <span
              className="font-display text-sm tabular-nums"
              style={{
                color: 'var(--bay-text)',
                fontVariationSettings: "'wght' var(--display-wght-bold)",
              }}
            >
              {ordinal}
            </span>
            <span
              aria-hidden
              className="h-px w-14"
              style={{
                background:
                  'linear-gradient(90deg, var(--bay), color-mix(in oklab, var(--bay) 10%, transparent))',
              }}
            />
            <span
              className="text-fg-subtle text-xs font-medium tracking-[0.16em] uppercase"
            >
              {categoryLabel}
            </span>
          </div>

          {/* The kinetic title — two layered real-text copies (ghost wiped away,
              final resolves in). One `<h2>` for the accessibility tree (the final
              copy holds the id + text); the ghost is aria-hidden.

              D-06: the final title resolves to the BOLD axis (was the neutral 440,
              which let the directory's 600 h3 out-weigh the primary bay title) and
              carries a lit hue glow, so it is unambiguously the focal point of the
              bay — heavier than the directory list, lit by the room's hue. */}
          <div className="relative">
            <span
              aria-hidden
              data-bay-title-ghost
              className="font-display text-display-bay pointer-events-none absolute inset-0 leading-[0.98] tracking-tight select-none"
              style={{
                color: 'var(--bay-text)',
                fontVariationSettings:
                  "'opsz' 144, 'wght' var(--display-wght-bold), 'SOFT' 0",
              }}
            >
              {project.name}
            </span>
            <h2
              id={`${bayId(project.slug)}-title`}
              data-bay-title-final
              className="font-display text-display-bay text-fg relative leading-[0.98] tracking-tight"
              style={{
                fontVariationSettings:
                  "'opsz' 144, 'wght' var(--display-wght-bold), 'SOFT' 0",
                textShadow:
                  '0 0 38px color-mix(in oklab, var(--bay) 34%, transparent)',
              }}
            >
              {project.name}
            </h2>
          </div>

          {/* The tagline — the tight label under the title. */}
          <p
            data-bay-reveal
            className="text-fg-subtle mt-4 text-sm font-medium tracking-[0.04em]"
          >
            {project.tagline}
          </p>

          {/* The pitch — the recruiter-facing description. */}
          <p
            data-bay-reveal
            className="text-fg-muted mt-6 max-w-xl text-base leading-relaxed text-balance sm:text-lg"
          >
            {project.pitch}
          </p>

          {/* The two unmissable outward links — Live demo (always live) + GitHub
              (U2 disabled affordance until REPO_LINKS_LIVE). Shared component, so
              the bay and the directory carry identical, discernibly-named links. */}
          <div data-bay-reveal>
            <ProjectLinks project={project} className="mt-8" />
          </div>
        </div>

        {/* The detail column — the wow-moment line + the stack ribbon. On a wide
            viewport it sits beside the type; on mobile it stacks beneath. Reserved
            as the slot a Task-4.5 preview still would drop into without reflow. */}
        <div data-bay-media className="flex flex-col gap-7">
          {/* The wow-moment line — "what holds you for five seconds". DEMOTED from
              a filled card (D-06): it was the only filled surface and won the eye
              over the title. Now a quiet hue-ruled note (a left hairline + a hue
              caption) that SUPPORTS the headline rather than competing with it. */}
          <figure
            data-bay-reveal
            className="border-border/70 relative border-l pl-5"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-px"
              style={{ backgroundColor: 'var(--bay)' }}
            />
            <figcaption
              className="text-xs font-medium tracking-[0.16em] uppercase"
              style={{ color: 'var(--bay-text)' }}
            >
              The wow moment
            </figcaption>
            <p className="text-fg-muted mt-3 text-base leading-relaxed text-balance">
              {project.wowMoment}
            </p>
          </figure>

          {/* The stack ribbon — the curated key-stack chips. */}
          <div data-bay-reveal>
            <h3 className="text-fg-subtle mb-3 text-xs font-medium tracking-[0.16em] uppercase">
              Stack
            </h3>
            <ul className="flex flex-wrap gap-2">
              {project.stack.map((chip) => (
                <li
                  key={chip}
                  className="border-border text-fg-muted rounded-md border px-2.5 py-1 text-xs font-medium"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
