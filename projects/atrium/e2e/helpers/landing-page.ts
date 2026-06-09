import type { Locator, Page } from '@playwright/test';

import { bayId, demoLinkName } from './projects';

/**
 * `landing-page.ts` — Page Object for the single long-form lobby route (`/`).
 *
 * Everything is queried by role + accessible name (the chrome and the bays were
 * built accessible-first — ADR-003: every outward link is a real focusable `<a>`
 * with a discernible name; the U2 repo control is a non-navigating
 * `aria-disabled` span removed from the tab order).
 *
 * The hero renders the real `<h1>` "ATRIUM" — the LCP element and the no-JS /
 * SSR / reduced-motion content floor. The directory section is the canonical
 * reachable index: exactly six live-demo anchors + six repo affordances, present
 * with JS disabled, under reduced motion, and in the full cinema.
 */
export class LandingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  /** The hero wordmark — the SSR / no-JS / LCP content floor. */
  heroHeading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: 'ATRIUM' });
  }

  /** The directory section (the no-cinema reachable floor). */
  directory(): Locator {
    return this.page.locator('#directory');
  }

  /** A project's bay section. */
  bay(slug: string): Locator {
    return this.page.locator(`#${bayId(slug)}`);
  }

  /**
   * A project's live-demo link(s) by its discernible accessible name. The same
   * named link appears in the bay AND the directory, so callers scope to a
   * section (e.g. `.directory().getByRole('link', { name })`) or use `.first()`.
   */
  demoLink(name: string): Locator {
    return this.page.getByRole('link', { name: demoLinkName(name) });
  }

  /** The directory's copy of a project's live-demo link (unambiguous). */
  directoryDemoLink(name: string): Locator {
    return this.directory().getByRole('link', { name: demoLinkName(name) });
  }

  /**
   * The repo affordance(s) — while the placeholder GITHUB_BASE is in force these
   * are disabled, `aria-disabled` spans (NOT links), so they are matched by
   * text, not role=link. Scope to a section for the directory's copy.
   */
  repoAffordances(): Locator {
    return this.page.locator('[aria-disabled="true"]', { hasText: 'GitHub repo' });
  }

  directoryRepoAffordances(): Locator {
    return this.directory().locator('[aria-disabled="true"]', {
      hasText: 'GitHub repo',
    });
  }

  /** The theme toggle — a button whose accessible name flips with the theme. */
  themeToggle(): Locator {
    return this.page.getByRole('button', {
      name: /Switch to (light|dark) theme|Toggle colour theme/i,
    });
  }

  /** The primary header nav (revealed after the hero). */
  primaryNav(): Locator {
    return this.page.getByRole('navigation', { name: 'Primary' });
  }
}
