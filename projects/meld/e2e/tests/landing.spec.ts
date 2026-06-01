import { expect, test } from '@playwright/test';

import { LandingPage } from '@helpers/landing-page';

/**
 * Test 1 — landing page renders the chrome.
 *
 * Verifies BrandMark + "New board" CTA + IdentityBadge + ApiStatusDot
 * + ThemeToggle all paint. The IdentityBadge initial render comes from
 * the SSR `/api/session` round-trip — if the server is reachable the
 * badge carries an emoji-name; if not it falls back to the anonymous
 * em-dash.
 *
 * Tagged `@smoke` — included in the deploy-verification subset.
 */
test.describe('landing — chrome renders', () => {
  test('all chrome controls visible on / @smoke', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(page).toHaveTitle(/Meld/i);

    await expect(landing.brandMark()).toBeVisible();
    await expect(landing.identityBadge()).toBeVisible();
    await expect(landing.apiStatusDot()).toBeVisible();
    await expect(landing.themeToggle()).toBeVisible();

    // The full-variant CTA renders at the default Desktop Chrome
    // viewport (1280x720) per the top-bar's `sm:` breakpoint. The
    // compact variant is `hidden sm:flex`'d out so only the full one
    // is in the document at this viewport.
    await expect(landing.topBarCta()).toBeVisible();

    // The placeholder card carries its OWN copy of the CTA — the
    // existence of two CTAs is the canonical landing shape. The card
    // CTA has `errorMode='inline'` so a click failure surfaces a
    // visible message; we only assert visibility here.
    await expect(landing.placeholderCta()).toBeVisible();
  });
});
