import { z } from 'zod';

/**
 * CSP: force Zod's interpreted (non-JIT) validation path.
 *
 * Zod v4 compiles fast validators with `new Function(...)` by default. atrium's
 * strict CSP forbids `unsafe-eval` (ADR-002), and although the PROJECTS parse was
 * intended to be build-time only, `src/data/projects.ts` is reachable from client
 * components (the header/mobile-nav import it transitively via `site-nav.ts`), so
 * the parse — and Zod's JIT `new Function` — would also run in the browser and
 * trip a `script-src eval` CSP violation. `jitless: true` switches Zod to the
 * interpreted validator, which uses no `eval`/`new Function`, keeping the page
 * CSP-clean with NO `unsafe-eval`. The parse runs once over six fixed entries, so
 * the JIT speedup is irrelevant here. (This generalises the razors-edge `D-CSP-1`
 * zod-eval lesson — which ADR-002 assumed did not apply — to atrium.)
 */
z.config({ jitless: true });

/**
 * The `Project` schema — the single contract for `src/data/projects.ts`
 * (ADR-003). Validated at module load (build time), so a malformed entry fails
 * the build LOUDLY rather than rendering a broken bay.
 *
 * Field set is fixed by ADR-003. Sourcing notes:
 *   - `pitch` is the recruiter-facing one/two-line description, sourced
 *     verbatim-faithfully from the root README project table.
 *   - `demoUrl` is the real public Fly URL, linked NORMALLY (the internal "Fly
 *     stopped to control cost" status is NEVER surfaced — ADR-003 / AGENT_NOTES).
 *   - `repoUrl` is DERIVED from the single `GITHUB_BASE` constant in
 *     `src/data/projects.ts` (never a hardcoded inline `github.com/...` string);
 *     the schema only validates the derived value is a URL.
 *   - `accentToken` names the bay's atrium-local signature-hue CSS variable
 *     (e.g. `--bay-tape`) — never a sibling import (§ 14).
 *   - `year` is a FIXED field, not `new Date()`-computed (determinism — no
 *     `Date.now()` / `Math.random()` in render).
 */

/** The six projects, also the canonical order key (tape → ... → atlas). */
export const PROJECT_SLUGS = [
  'tape',
  'meld',
  'razors-edge',
  'pulse',
  'apex',
  'atlas',
] as const;

export const projectSlugSchema = z.enum(PROJECT_SLUGS);
export type ProjectSlug = z.infer<typeof projectSlugSchema>;

export const projectCategorySchema = z.enum(['api-heavy', 'web-only']);
export type ProjectCategory = z.infer<typeof projectCategorySchema>;

/** The four distinct backends represented across the api-heavy projects. */
export const projectBackendSchema = z.enum([
  'Elysia (Bun)',
  'Hono (Node)',
  'NestJS',
  'Fastify',
]);
export type ProjectBackend = z.infer<typeof projectBackendSchema>;

/** The six atrium-local signature-hue token names (ADR-003). */
export const accentTokenSchema = z.enum([
  '--bay-tape',
  '--bay-meld',
  '--bay-razors-edge',
  '--bay-pulse',
  '--bay-apex',
  '--bay-atlas',
]);
export type AccentToken = z.infer<typeof accentTokenSchema>;

export const projectSchema = z
  .object({
    slug: projectSlugSchema,
    /** Display name (the wordmark/title of the bay). */
    name: z.string().min(1),
    /** A tight (≤ ~8-word) label for the bay. */
    tagline: z.string().min(1),
    /** The recruiter-facing one/two-line description (root README, verbatim). */
    pitch: z.string().min(1),
    category: projectCategorySchema,
    /** Non-null only for the four api-heavy projects; null for web-only. */
    backend: projectBackendSchema.nullable(),
    /** The curated key stack chips shown on the bay (subset of the README stack). */
    stack: z.array(z.string().min(1)).min(1),
    /** The atrium-local signature-hue CSS variable name. */
    accentToken: accentTokenSchema,
    /** The one-line "what holds you for five seconds" per project. */
    wowMoment: z.string().min(1),
    /** The real public Fly URL, linked normally. */
    demoUrl: z.url(),
    /** Derived from `GITHUB_BASE` — never inline. Validated as a URL. */
    repoUrl: z.url(),
    /**
     * Optional preview-still KEY (Task 4.5, the atrium v2 enrichment). When set,
     * it is the project slug; the bay's `PreviewStill` resolves it to a
     * theme-matched dark+light AVIF pair (static-imported, lazy, never the LCP).
     */
    previewImage: z.string().optional(),
    /** Fixed year (deterministic — not computed). */
    year: z.number().int(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Backend presence must agree with category: every api-heavy project names a
    // backend; every web-only project has none. This catches a mis-typed entry
    // at build time.
    if (value.category === 'api-heavy' && value.backend === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['backend'],
        message: `api-heavy project "${value.slug}" must name a backend`,
      });
    }
    if (value.category === 'web-only' && value.backend !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['backend'],
        message: `web-only project "${value.slug}" must have a null backend`,
      });
    }
    // The accent token must match the slug (the bay carries its own hue).
    if (value.accentToken !== `--bay-${value.slug}`) {
      ctx.addIssue({
        code: 'custom',
        path: ['accentToken'],
        message: `project "${value.slug}" must use accentToken "--bay-${value.slug}"`,
      });
    }
  });

export type Project = z.infer<typeof projectSchema>;

/** The ordered collection contract — exactly six, in canonical order. */
export const projectsSchema = z
  .array(projectSchema)
  .length(PROJECT_SLUGS.length)
  .superRefine((projects, ctx) => {
    projects.forEach((project, index) => {
      if (project.slug !== PROJECT_SLUGS[index]) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'slug'],
          message: `project at index ${String(index)} must be "${String(PROJECT_SLUGS[index])}" (canonical order), got "${project.slug}"`,
        });
      }
    });
  });
