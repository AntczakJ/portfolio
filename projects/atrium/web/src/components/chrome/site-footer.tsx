import { GitBranch, Mail } from 'lucide-react';
import type { ReactNode } from 'react';

import { Threshold } from '@/components/atmosphere/threshold';
import { PROJECTS } from '@/data/projects';
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  GITHUB_BASE,
  REPO_LINKS_LIVE,
  SITE_NAME,
} from '@/lib/site-config';
import { DIRECTORY_SECTION_ID, bayId } from '@/lib/site-nav';

/**
 * The designed footer (Task 3.1) — a strong brand surface, not a sitemap dump
 * (PLAN IA item 6). It carries the ATRIUM wordmark as a specimen, a compact
 * repeat of the six project anchors, the contact affordance, the profile link
 * (gated on the single `GITHUB_BASE` seam — ADR-003), and a credits/legal line.
 *
 * It is a SERVER component — every link is real, focusable DOM, present with JS
 * disabled. The threshold motif tops it so the scroll resolves INTO the footer
 * through a lit seam, consistent with the bay-to-bay transitions. The six anchors
 * here are part of the "every project reachable without the cinema" floor.
 *
 * The GitHub profile link uses the SAME `REPO_LINKS_LIVE` seam as the per-project
 * repo affordances: while the placeholder base is in force it renders as a quiet
 * disabled control (never a broken click — ADR-003 / U2), and flips to a live
 * `<a>` the instant `NEXT_PUBLIC_GITHUB_BASE` is set.
 */
export function SiteFooter(): ReactNode {
  const year = 2026; // fixed (determinism — AGENT_NOTES; never new Date()).

  return (
    <footer className="relative">
      <Threshold weight="minor" />

      <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
        <div className="border-border grid gap-12 border-t pt-14 md:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand block. */}
          <div className="flex flex-col gap-5">
            <p
              className="font-display text-fg text-4xl leading-none tracking-tight"
              style={{ fontVariationSettings: "'wght' var(--display-wght-bold)" }}
            >
              ATRIUM
            </p>
            <p className="text-fg-muted max-w-sm text-sm leading-relaxed text-balance">
              The portfolio of {AUTHOR_NAME} — six production-grade showcases,
              four backends, one quality bar.
            </p>
            <div className="mt-1 flex items-center gap-3">
              <a
                href={`mailto:${AUTHOR_EMAIL}`}
                aria-label={`Email ${AUTHOR_NAME}`}
                className="border-border-strong text-fg-muted hover:text-fg hover:border-light/60 inline-flex size-9 items-center justify-center rounded-md border transition-colors"
              >
                <Mail aria-hidden className="size-4" />
              </a>
              {REPO_LINKS_LIVE ? (
                <a
                  href={GITHUB_BASE}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${AUTHOR_NAME} on GitHub`}
                  className="border-border-strong text-fg-muted hover:text-fg hover:border-light/60 inline-flex size-9 items-center justify-center rounded-md border transition-colors"
                >
                  <GitBranch aria-hidden className="size-4" />
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  title="Repository link available once published"
                  className="border-border text-fg-subtle inline-flex size-9 cursor-not-allowed items-center justify-center rounded-md border opacity-60"
                >
                  <GitBranch aria-hidden className="size-4" />
                  <span className="sr-only">
                    Repository link available once published
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Showcases — compact six-link repeat (anchors to the bays). */}
          <nav aria-label="Showcases">
            <h2 className="text-fg-subtle mb-4 text-xs font-medium tracking-[0.12em] uppercase">
              Showcases
            </h2>
            <ul className="flex flex-col gap-2.5">
              {PROJECTS.map((project) => (
                <li key={project.slug}>
                  <a
                    href={`#${bayId(project.slug)}`}
                    className="text-fg-muted hover:text-fg font-display text-sm tracking-tight transition-colors"
                  >
                    {project.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Explore — the directory + contact. */}
          <nav aria-label="Explore">
            <h2 className="text-fg-subtle mb-4 text-xs font-medium tracking-[0.12em] uppercase">
              Explore
            </h2>
            <ul className="flex flex-col gap-2.5">
              <li>
                <a
                  href={`#${DIRECTORY_SECTION_ID}`}
                  className="text-fg-muted hover:text-fg text-sm transition-colors"
                >
                  Directory
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${AUTHOR_EMAIL}`}
                  className="text-fg-muted hover:text-fg text-sm transition-colors"
                >
                  Contact
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="border-border text-fg-subtle mt-14 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} {AUTHOR_NAME}. {SITE_NAME} — the portfolio lobby.
          </p>
          <p>Built with Next.js, GSAP, and one quality bar.</p>
        </div>
      </div>
    </footer>
  );
}
