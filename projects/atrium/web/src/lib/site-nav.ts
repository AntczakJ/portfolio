import { PROJECTS } from '@/data/projects';

/**
 * The in-page anchor targets the chrome navigates to. There are no sub-routes in
 * v1 (PLAN IA) — the header nav, the mobile drawer, and the footer all jump to
 * `#<id>` sections on the single long-form route, and the header's `aria-current`
 * is driven by which of these sections is in view (IntersectionObserver, ADR-002
 * — state observation, not GSAP).
 *
 * `SECTION_IDS` is the ordered scroll spine used both to render the nav and to
 * register the observer. The six project bays each get their `bay-<slug>` id so a
 * `/#tape` style deep-link resolves to the right bay (the optional per-project
 * anchor the planner left to Task 3.1 — cheap, and it makes the header nav and
 * the footer repeat share one id contract).
 */

export const HERO_SECTION_ID = 'top';
export const DIRECTORY_SECTION_ID = 'directory';
export const ABOUT_SECTION_ID = 'about';

export function bayId(slug: string): string {
  return `bay-${slug}`;
}

export interface NavItem {
  /** The `#<id>` fragment target. */
  id: string;
  /** The visible, short label. */
  label: string;
  /** A longer accessible name when the label alone is ambiguous. */
  ariaLabel?: string;
}

/** The six project jumps — the centre of the header nav. */
export const PROJECT_NAV_ITEMS: readonly NavItem[] = PROJECTS.map((project) => ({
  id: bayId(project.slug),
  label: project.name,
  ariaLabel: `Jump to ${project.name}`,
}));

/** The directory jump — the calm, fully-legible index of all six projects. */
export const DIRECTORY_NAV_ITEM: NavItem = {
  id: DIRECTORY_SECTION_ID,
  label: 'Directory',
  ariaLabel: 'Jump to the full project directory',
};

/**
 * Every section the header observes for `aria-current`, in scroll order: the six
 * bays, then the directory. The hero is intentionally omitted — the header is
 * hidden over the hero and only reveals past it (ADR-003 IA), so there is no
 * "hero is current" state to express.
 */
export const OBSERVED_SECTION_IDS: readonly string[] = [
  ...PROJECT_NAV_ITEMS.map((item) => item.id),
  DIRECTORY_SECTION_ID,
];
