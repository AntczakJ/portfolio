import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * `landing-page.ts` — Page Object for the meld landing route (`/`).
 *
 * The landing renders the chrome (BrandMark + IdentityBadge +
 * ApiStatusDot + ThemeToggle + NewBoardButton) AROUND a centered
 * `<CanvasPlaceholder />` card with the same NewBoardButton inside the
 * card. Tests typically click EITHER the top-bar CTA or the
 * placeholder card CTA; the POM exposes both.
 *
 * The chrome's `NewBoardButton` carries `data-testid="new-board-cta"`
 * on BOTH instances (top-bar + placeholder); when both render, the
 * locator MUST disambiguate by visible region or by the `variant`
 * prop. The placeholder instance always uses `variant='full'`, which
 * matches the top-bar's full variant at >=640 px — so we use `.first()`
 * for the chrome-region locator and `.last()` for the placeholder
 * locator under a single-viewport assumption. The default 1280x720
 * Chrome viewport in `devices['Desktop Chrome']` keeps the top-bar
 * full variant in the DOM; the compact variant is `hidden sm:flex`'d
 * out at >=640 px so only the full one is visible.
 */
export class LandingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  brandMark(): Locator {
    return this.page.getByTestId('brand-mark');
  }

  identityBadge(): Locator {
    return this.page.getByTestId('identity-badge');
  }

  apiStatusDot(): Locator {
    return this.page.getByTestId('api-status-dot');
  }

  themeToggle(): Locator {
    return this.page.getByTestId('theme-toggle');
  }

  /**
   * The visible "New board" CTA. The top-bar full-variant button and
   * the placeholder card button BOTH carry `data-testid="new-board-cta"`.
   * `.first()` matches the chrome instance which is the DOM-first one.
   * Tests that explicitly want the card CTA use `placeholderCta()`.
   */
  topBarCta(): Locator {
    return this.page.getByTestId('new-board-cta').first();
  }

  placeholderCta(): Locator {
    return this.page.getByTestId('new-board-cta').last();
  }

  /**
   * Click the visible chrome CTA and wait for the navigation to a
   * `/board/<uuid>` URL. Returns the captured board id from the URL.
   */
  async clickAndAwaitRedirect(): Promise<string> {
    await Promise.all([
      this.page.waitForURL(/\/board\/[0-9a-f-]{36}$/, { timeout: 30_000 }),
      this.topBarCta().click(),
    ]);
    const url = new URL(this.page.url());
    const segments = url.pathname.split('/');
    const boardId = segments[segments.length - 1] ?? '';
    expect(boardId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    return boardId;
  }
}
