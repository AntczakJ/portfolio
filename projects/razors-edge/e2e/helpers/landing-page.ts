import type { Locator, Page } from '@playwright/test';

/**
 * `landing-page.ts` — Page Object for the marketing route (`/`).
 *
 * The hero renders the real `<h1>` "Razor's Edge" (sr-only, carried visually
 * by the two clip-path wordmark halves) — that is the no-JS / SSR floor the
 * landing smoke asserts. The persistent header carries the primary nav and
 * the "Book a chair" CTA, plus the theme toggle. Everything is queried by
 * role + accessible name (the chrome was built accessible-first).
 */
export class LandingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  /** The hero accessible heading — the SSR/no-JS content floor. */
  heroHeading(): Locator {
    return this.page.getByRole('heading', { level: 1, name: /Razor.s Edge/i });
  }

  /** The primary anchor nav in the header (desktop). */
  primaryNav(): Locator {
    return this.page.getByRole('navigation', { name: 'Primary' });
  }

  /** The header "Book a chair" CTA (a link, role=link). */
  bookCta(): Locator {
    return this.page.getByRole('link', { name: 'Book a chair' }).first();
  }

  themeToggle(): Locator {
    // The toggle is a button; its accessible name flips with the theme
    // ("Switch to light theme" / "Switch to dark theme"). Match either.
    return this.page.getByRole('button', { name: /Switch to (light|dark) theme/i });
  }
}
