/**
 * Canonical site configuration — the single source of truth for the deployed
 * origin (used by `metadataBase`, `sitemap.ts`, `robots.ts`, the OG image, and
 * the JSON-LD `url`/`@id`) and for the GitHub-link strategy.
 *
 * atrium is intended as the eventual portfolio ROOT landing page (AGENT_NOTES
 * "Cross-cutting"), so the metadata is authored as the portfolio's PRIMARY
 * metadata, not a sub-project's — even though v1 ships as a self-contained
 * `projects/atrium/` app like every sibling and does not restructure the
 * monorepo.
 */

/**
 * Canonical public origin. Comes from `NEXT_PUBLIC_SITE_URL` (see
 * `.env.example`); unset, it falls back to a documented placeholder production
 * URL so generated absolute URLs are sensible even before a real deploy. The
 * local dev/prod-test server runs on :3080, but the canonical metadata should
 * reflect the public origin, hence the placeholder rather than localhost.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://atrium.fly.dev'
).replace(/\/$/, '');

export const SITE_NAME = 'Atrium';

export const SITE_DESCRIPTION =
  'The portfolio of Jan Antczak — six production-grade showcases, four backends, one quality bar. A scroll-driven cinematic lobby.';

/**
 * GITHUB_BASE — the single flippable seam for all six per-project repo links
 * (ADR-001 / ADR-003).
 *
 * The repo has NO git remote yet (CLAUDE.md § 10), so per-repo GitHub links
 * cannot be real today. Every project's `repoUrl` is DERIVED from this one
 * constant (never a hardcoded inline `github.com/...` string in a component).
 *
 *   - Shape is R1 (monorepo deep-link): `${GITHUB_BASE}/tree/main/projects/<slug>`,
 *     matching the actual one-monorepo / six-`projects/<slug>`-folders layout.
 *     The split-repo R2 shape (`${GITHUB_BASE}-<slug>`) is the documented
 *     migration if the owner later publishes per-project repos — change only the
 *     `repoUrl` derivation in `src/data/projects.ts`, never the six call sites.
 *   - `GITHUB_PLACEHOLDER` is a documented guess; OWNER MUST CONFIRM/CORRECT the
 *     owner/repo slug (harmless if wrong: while a placeholder is in force, the
 *     repo affordance is a disabled, non-navigating control — ADR-003 / U2 — so
 *     it never navigates to the placeholder).
 *   - `REPO_LINKS_LIVE` flips to `true` the instant `NEXT_PUBLIC_GITHUB_BASE`
 *     is set to anything other than the placeholder. The bay/directory repo
 *     affordance reads this single boolean to render a live `<a href={repoUrl}>`
 *     instead of the disabled "coming soon" control — with NO other change. That
 *     is the single seam.
 */
export const GITHUB_PLACEHOLDER = 'https://github.com/janantczak/portfolio'.replace(
  /\/$/,
  '',
);

export const GITHUB_BASE = (
  process.env.NEXT_PUBLIC_GITHUB_BASE ?? GITHUB_PLACEHOLDER
).replace(/\/$/, '');

// Compare the normalized base against the normalized placeholder so a
// trailing-slash placeholder env value cannot accidentally read as "live"
// (both sides pass through the same `.replace(/\/$/, '')`).
export const REPO_LINKS_LIVE = GITHUB_BASE !== GITHUB_PLACEHOLDER;

/** Author / contact — surfaced in the about section and footer. */
export const AUTHOR_NAME = 'Jan Antczak';
export const AUTHOR_EMAIL = 'janek.antczak@gmail.com';
