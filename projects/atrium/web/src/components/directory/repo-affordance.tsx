import { ExternalLink, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { Project } from '@/lib/schemas/project';
import { REPO_LINKS_LIVE } from '@/lib/site-config';

/**
 * The two outward links for a project — Live demo + GitHub repo (ADR-003 / U2).
 *
 * The DEMO is always a real, live `<a>` to the project's public Fly URL, linked
 * normally (the internal "Fly stopped" status is never surfaced — AGENT_NOTES).
 *
 * The REPO is the single `REPO_LINKS_LIVE` seam: while the placeholder
 * `GITHUB_BASE` is in force it renders as a DISABLED, `aria-disabled`,
 * non-navigating control (NOT an `<a href>` to a 404) with an accessible "available
 * once published" label — so a recruiter never clicks a broken GitHub link on the
 * most-judged page. The instant `NEXT_PUBLIC_GITHUB_BASE` is set to a real base,
 * `REPO_LINKS_LIVE` flips true and the repo becomes a live `<a href={repoUrl}>`
 * with NO other change. That is the seam.
 *
 * Both controls carry DISCERNIBLE accessible names that disambiguate across the
 * twelve links ("tape — live demo" / "tape — GitHub repo"), per the success
 * criteria. Outward links carry `rel="noopener noreferrer"` + `target="_blank"`.
 *
 * SERVER component — used by both the directory floor (Phase 3) and the Phase-4
 * bays. The final styling here is recorded in AGENT_NOTES so the designer-critic
 * can confirm the disabled state reads as intentional ("coming soon"), never as a
 * broken button.
 */

const baseLink =
  'inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors';

export function ProjectLinks({
  project,
  className,
}: {
  project: Project;
  className?: string;
}): ReactNode {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <a
        href={project.demoUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${project.name} — live demo`}
        className={cn(
          baseLink,
          'border-light/50 bg-light/10 text-light-strong hover:bg-light/20 hover:border-light',
        )}
      >
        <ExternalLink aria-hidden className="size-4" />
        Live demo
      </a>

      {REPO_LINKS_LIVE ? (
        <a
          href={project.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${project.name} — GitHub repository`}
          className={cn(
            baseLink,
            'border-border-strong text-fg-muted hover:text-fg hover:border-light/60',
          )}
        >
          <GitBranch aria-hidden className="size-4" />
          GitHub repo
        </a>
      ) : (
        <span
          aria-disabled="true"
          // Not an <a href> — a non-navigating control that reads as intentional
          // ("coming soon"), never a broken link. Dashed border + reduced opacity
          // signal "present but not yet active"; the sr-only text + title give the
          // accessible explanation. Removed from the tab order (no tabIndex, not a
          // link/button) so keyboard users are not stopped on a dead control.
          title="Repository link available once published"
          className={cn(
            baseLink,
            'border-border text-fg-subtle cursor-not-allowed border-dashed opacity-70',
          )}
        >
          <GitBranch aria-hidden className="size-4" />
          GitHub repo
          <span className="sr-only">
            — link available once the repository is published
          </span>
        </span>
      )}
    </div>
  );
}
