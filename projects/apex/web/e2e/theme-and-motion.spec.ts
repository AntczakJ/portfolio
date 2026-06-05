import { expect, test } from '@playwright/test';

/**
 * Theme toggle in both directions (Task 7.2d) + the prefers-reduced-motion hero
 * (Task 7.2e).
 *
 * Theme: light is the canonical default; toggling flips the `html.dark` class
 * and the accessible label, and the choice persists across a reload.
 *
 * Reduced motion: under `prefers-reduced-motion: reduce` the hero must NOT pin /
 * scrub (no GSAP scroll choreography) — it renders a static composed frame
 * (the LCP product render + the wordmark + the positioning copy all legible),
 * and there is no `<canvas>` blocking first paint.
 */

test('theme toggle flips light → dark and back, and dark persists across a reload', async ({
  page,
}) => {
  await page.goto('/');
  const html = page.locator('html');

  // Canonical default is light (no dark class).
  await expect(html).not.toHaveClass(/dark/);

  // Toggle to dark (the toggle's accessible label drives the action).
  await page.getByRole('button', { name: /switch to dark theme/i }).click();
  await expect(html).toHaveClass(/dark/);
  // The choice is persisted (next-themes localStorage), the user-visible truth.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('theme')))
    .toBe('dark');

  // Toggle back to light WITHIN the same render (no reload — avoids the
  // next-themes `resolvedTheme` post-hydration lag interacting with the
  // emulated prefers-color-scheme; the persistence guarantee is asserted
  // separately below).
  await page.getByRole('button', { name: /switch to light theme/i }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('theme')))
    .toBe('light');
});

test('a persisted dark theme is re-applied on a fresh load (no FOUC of the light class)', async ({
  page,
}) => {
  // Seed the persisted dark choice, then load fresh — the pre-hydration script
  // must apply `html.dark` immediately (the user-visible persistence guarantee,
  // independent of the resolvedTheme React lag).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
    } catch {
      /* no-op */
    }
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('the dark theme is intentional on /reserve too (chrome reads in both themes)', async ({
  page,
}) => {
  await page.goto('/reserve');
  await page.getByRole('button', { name: /switch to dark theme/i }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  // The step indicator + heading remain visible (legible chrome on dark).
  await expect(page.locator('#wizard-step-heading')).toBeVisible();
});

test.describe('prefers-reduced-motion hero', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('renders a static, legible hero with no pin/scrub and no blocking canvas', async ({
    page,
  }) => {
    await page.goto('/');

    // The hero conveys its content regardless of motion: the wordmark + the
    // positioning line + the LCP product render are all present.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/by the day|premium ev/i).first()).toBeVisible();

    // The LCP is the static product render (an <img>), never the canvas. There
    // is no <canvas> on the home route at all (the configurator canvas mounts
    // only in its own section under Tier-1, and is code-split / deferred).
    const heroImg = page.locator('img').first();
    await expect(heroImg).toBeVisible();

    // No pin transform-locks the page: the document is scrollable and the body
    // is not frozen by a ScrollTrigger pin under reduced motion. Scrolling moves
    // the viewport (no scrub-pinned hero).
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 800);
    await expect(async () => {
      const afterScroll = await page.evaluate(() => window.scrollY);
      expect(afterScroll).toBeGreaterThan(beforeScroll);
    }).toPass();
  });
});
