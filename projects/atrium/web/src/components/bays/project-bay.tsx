import type { CSSProperties, ReactNode } from 'react';

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
 * ── B-01: ONE BUILDING, SIX DISTINCT ROOMS ─────────────────────────────────
 * The critique's lead defect: the six bays were one grid recoloured six times
 * (title-left / detail-right, light always top-right, identical spacing). That
 * defeats the variance-is-the-point thesis. Cohesion is NOT sameness — it is a
 * shared SYSTEM (one baseline rhythm, one light language, one type discipline)
 * with each room intentionally composed differently. So this component selects a
 * `layout` and a `light` direction DETERMINISTICALLY off the bay index (never
 * random — determinism is a hard constraint), giving three distinct room layouts
 * that alternate down the tour:
 *   - `left`   — title column left, detail column right (the classic gallery wall);
 *   - `right`  — mirrored: title right, detail left (the opposite wall);
 *   - `centre` — the title held as a centred specimen with the detail in a ruled
 *                row beneath (an apse / end-of-hall room).
 * The light source ALSO moves per room (top-right / top-left / overhead), so no
 * two adjacent rooms are lit from the same direction. All bound by the same hue
 * system, rhythm, and type — clearly the same atrium, six distinct bays.
 *
 * ── B-02 / D-10: the hue BATHES the room (it does not halo it) ──────────────
 * The light-field now floods the WHOLE bay with the hue: a broad ambient tint
 * across the full section + a tall floor pool that rises HIGH behind the type
 * (so the title stands IN coloured light) + the room's directional light source.
 * The deep `--bay-*-floor` token does the bathing; the lighter `--bay` is the
 * accent edge. Driven by `color-mix`, so it holds on both the dark charcoal and
 * the cream (light-theme) grounds (D-12).
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
 */

interface ProjectBayProps {
  project: Project;
  /** 1-based position in the tour, shown as the bay index (01 … 06). */
  index: number;
}

/** A bay's compositional layout — the gallery wall it lives on (B-01). */
type BayLayout = 'left' | 'right' | 'centre';
/** Where the room's primary light source sits (B-01 — varies per room). */
type LightDir = 'tr' | 'tl' | 'top';

/**
 * Deterministic per-bay composition: the layout + light direction are a pure
 * function of the bay's ordinal, so the tour alternates rooms predictably (no
 * randomness — a hard constraint; screenshots stay reproducible). The cycle is
 * left → right → centre, so adjacent bays never share a wall, and the light
 * source rotates so adjacent rooms are never lit from the same side.
 */
function compositionFor(index: number): { layout: BayLayout; light: LightDir } {
  const layouts: BayLayout[] = ['left', 'right', 'centre'];
  const lights: LightDir[] = ['tr', 'tl', 'top'];
  const i = (index - 1) % 3;
  return { layout: layouts[i] ?? 'left', light: lights[i] ?? 'tr' };
}

/** The directional light-source gradient for a room, by light position. */
function lightSourceStyle(light: LightDir): CSSProperties {
  const at =
    light === 'tr' ? '82% -8%' : light === 'tl' ? '18% -8%' : '50% -14%';
  const size = light === 'top' ? '120% 70%' : '78% 78%';
  return {
    background: `radial-gradient(${size} at ${at}, color-mix(in oklab, var(--bay) 46%, transparent), transparent 64%)`,
  };
}

export function ProjectBay({ project, index }: ProjectBayProps): ReactNode {
  const ordinal = String(index).padStart(2, '0');
  const categoryLabel =
    project.category === 'api-heavy'
      ? `api-heavy · ${project.backend ?? ''}`
      : 'web-only (creative)';

  const { layout, light } = compositionFor(index);
  const isCentre = layout === 'centre';
  const titleFirst = layout !== 'right';

  // Dynamic per-bay hue tokens => inline custom properties scoped to the bay, so
  // the markup below reads from `--bay`/`--bay-text`/`--bay-on`/`--bay-floor`
  // regardless of which project this is (no per-project class explosion).
  // Genuinely dynamic (computed from data) — the allowed inline-style case.
  const hueVars = {
    '--bay': `var(${project.accentToken})`,
    '--bay-text': `var(${project.accentToken}-text)`,
    '--bay-on': `var(${project.accentToken}-on)`,
    '--bay-floor': `var(${project.accentToken}-floor)`,
  } as CSSProperties;

  // ── The bay's lit type-and-light column (B-02 light bathing handled by the
  //    section's wash; this is the content). Factored so the `left`/`right`/
  //    `centre` layouts can place it without duplicating markup.
  const titleColumn = (
    <div
      className={
        isCentre
          ? 'flex flex-col items-center text-center'
          : 'flex flex-col items-start'
      }
    >
      {/* Bay index + hue rule + category — the "room number" eyebrow. */}
      <div
        data-bay-reveal
        className={
          isCentre
            ? 'mb-6 flex items-center justify-center gap-4'
            : 'mb-6 flex items-center gap-4'
        }
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
        <span className="text-fg-subtle text-xs font-medium tracking-[0.16em] uppercase">
          {categoryLabel}
        </span>
      </div>

      {/* The kinetic title — two layered real-text copies (ghost wiped away,
          final resolves in). One `<h2>` for the accessibility tree (the final
          copy holds the id + text); the ghost is aria-hidden. The final title
          resolves to the BOLD axis and carries a lit hue glow, so it is
          unambiguously the focal point of the bay (D-06). */}
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
        {/* D-15 — the travelling WIPE EDGE. A third layered copy of the word in
            the BRIGHT signature hue with a hue glow; the sequence clips it to ride
            the wipe front across the title as it resolves, so the resolve reads as
            an unmistakable clip wipe (a bright leading edge sweeping the word) and
            not a tint settle. aria-hidden (the <h2> below is the only a11y copy);
            invisible at the resting frame (no-JS / reduced-motion) — only the armed
            cinema reveals it. */}
        <span
          aria-hidden
          data-bay-title-edge
          className="font-display text-display-bay pointer-events-none absolute inset-0 leading-[0.98] tracking-tight select-none"
          style={{
            color: 'var(--bay)',
            fontVariationSettings:
              "'opsz' 144, 'wght' var(--display-wght-bold), 'SOFT' 0",
            textShadow:
              '0 0 24px color-mix(in oklab, var(--bay) 80%, transparent)',
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
              '0 0 44px color-mix(in oklab, var(--bay) 42%, transparent)',
          }}
        >
          {project.name}
        </h2>
      </div>

      {/* D-07 / D-17 — tightened vertical rhythm. The tagline now sits CLOSE to
          the title (mt-3, was orphaned at mt-4 with the wow-note pulling the eye
          away); a single ruled hue tick binds it to the headline so the two read
          as one unit, the way the directory binds its heavy headline to its body.
          The pitch then follows on the section's baseline step. */}
      <p
        data-bay-reveal
        className={
          isCentre
            ? 'text-fg-muted mt-3 flex items-center gap-3 text-sm font-medium tracking-[0.04em]'
            : 'text-fg-muted mt-3 flex items-center gap-3 text-sm font-medium tracking-[0.04em]'
        }
      >
        <span
          aria-hidden
          className="inline-block h-px w-6"
          style={{ backgroundColor: 'var(--bay)' }}
        />
        {project.tagline}
      </p>

      {/* The pitch — the recruiter-facing description. */}
      <p
        data-bay-reveal
        className={`text-fg text-balance mt-6 text-lg leading-relaxed sm:text-xl ${
          isCentre ? 'mx-auto max-w-2xl' : 'max-w-xl'
        }`}
      >
        {project.pitch}
      </p>

      {/* The two unmissable outward links — Live demo (always live) + GitHub
          (U2 disabled affordance until REPO_LINKS_LIVE). Shared component. */}
      <div data-bay-reveal>
        <ProjectLinks
          project={project}
          className={isCentre ? 'mt-8 justify-center' : 'mt-8'}
        />
      </div>
    </div>
  );

  // ── The detail column — wow-note (promoted, D-18) + the ruled stack spec
  //    (D-19). Reserved as the slot a Task-4.5 preview still would drop into.
  const detailColumn = (
    <div
      data-bay-media
      className={
        isCentre
          ? 'grid gap-x-12 gap-y-8 sm:grid-cols-2'
          : 'flex flex-col gap-9'
      }
    >
      {/* D-18 — the wow-moment is PROMOTED to a clear secondary, out-ranking the
          stack. It was over-demoted to a tiny far-right label the eye never
          reached; now it is the largest supporting text on the bay — a hue-ruled
          pull-quote that holds you for the five seconds it describes. It still
          sits below the title in weight (the title stays the focal point, D-06),
          but above the stack spec in the reading order and in size. */}
      <figure
        data-bay-reveal
        className="border-l-2 pl-6"
        style={{ borderColor: 'color-mix(in oklab, var(--bay) 70%, transparent)' }}
      >
        <figcaption
          className="text-xs font-semibold tracking-[0.18em] uppercase"
          style={{ color: 'var(--bay-text)' }}
        >
          The wow moment
        </figcaption>
        <p className="text-fg text-balance mt-3 text-base leading-relaxed sm:text-lg">
          {project.wowMoment}
        </p>
      </figure>

      {/* D-19 — the stack as a Klim-style ruled typographic spec list, NOT
          generic bordered pills. Each line is hue-ticked + ruled, so it reads as
          an architectural spec sheet rather than a row of form tags, and it
          carries the room's hue. */}
      <div data-bay-reveal>
        <h3 className="text-fg-subtle mb-3 text-xs font-semibold tracking-[0.18em] uppercase">
          Stack
        </h3>
        <ul className="text-fg-muted divide-border/70 border-border/70 divide-y border-t text-sm">
          {project.stack.map((chip) => (
            <li key={chip} className="flex items-center gap-3 py-2">
              <span
                aria-hidden
                className="h-1 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: 'var(--bay)' }}
              />
              <span className="font-medium tracking-[0.01em]">{chip}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <section
      id={bayId(project.slug)}
      aria-labelledby={`${bayId(project.slug)}-title`}
      data-bay
      data-bay-slug={project.slug}
      data-bay-layout={layout}
      style={hueVars}
      className="relative flex min-h-[100svh] scroll-mt-24 items-center overflow-hidden px-6 py-24 sm:py-28"
    >
      {/* THE BAY LIGHT-FIELD (B-02 / D-10 / D-12) — the hue does not trim the
          room, it BATHES it. Four token-driven layers flood the WHOLE bay with
          coloured light so the type stands IN it, on both grounds:
            1. a broad AMBIENT hue tint across the full section (the room's air);
            2. the room's DIRECTIONAL light source (position varies per bay, B-01);
            3. a tall floor POOL rising high behind the type (the deep `-floor`
               token — a tinted floor the type sits on, not a bottom-edge halo);
            4. a soft centre lift so the title band is lit, not a black void.
          All aria-hidden decoration; the scrub fades them up on lock-in. */}
      <div aria-hidden data-bay-wash className="pointer-events-none absolute inset-0 -z-0">
        {/* 1 — broad ambient hue tint across the whole room. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in oklab, var(--bay-floor) 22%, transparent) 0%, color-mix(in oklab, var(--bay-floor) 34%, transparent) 100%)',
          }}
        />
        {/* 2 — the room's directional light source (varies per bay — B-01). */}
        <div className="absolute inset-0" style={lightSourceStyle(light)} />
        {/* 3 — the tall floor pool the type stands in (rises to ~82% so it
            reaches up behind the title band, not a bottom-edge halo — D-10). */}
        <div
          className="absolute inset-x-0 bottom-0 h-[88%]"
          style={{
            background:
              'radial-gradient(96% 100% at 50% 116%, color-mix(in oklab, var(--bay-floor) 64%, transparent), color-mix(in oklab, var(--bay-floor) 24%, transparent) 58%, transparent 84%)',
          }}
        />
        {/* 4 — a soft centre lift so the type band sits in light, not a void. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 60% at 50% 52%, color-mix(in oklab, var(--bay) 14%, transparent), transparent 72%)',
          }}
        />
      </div>

      {isCentre ? (
        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-14">
          {titleColumn}
          {detailColumn}
        </div>
      ) : (
        <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-x-14 gap-y-12 lg:grid-cols-[1.34fr_0.66fr] lg:items-center">
          {titleFirst ? (
            <>
              {titleColumn}
              {detailColumn}
            </>
          ) : (
            <>
              {/* Mirrored room (B-01 `right`): detail on the left, title on the
                  right. `order` keeps the title FIRST in the DOM/reading order
                  (the <h2> leads for SR + source order) while it paints right. */}
              <div className="lg:order-2">{titleColumn}</div>
              <div className="lg:order-1">{detailColumn}</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
