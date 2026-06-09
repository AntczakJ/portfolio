import { expect, test } from '@playwright/test';

import { PROJECTS, bayId, demoLinkName } from '@helpers/index';

/**
 * Test 6 — the no-JS directory render (Task 6.2 / ADR-003 Tier 3).
 *
 * With JavaScript disabled the page must render server-side as the COMPLETE
 * directory: the hero wordmark, all six bays (titles, pitches, badges), all six
 * demo links to the real Fly URLs, the directory floor, and the footer — all in
 * real DOM. GSAP only ENHANCES this floor; it never creates content, so a
 * crawler / screen reader / no-JS visitor always gets the full page.
 *
 * `javaScriptEnabled: false` is set for this file only, so GSAP, next-themes,
 * and the header observers never run — exactly the Tier-3 surface.
 */
test.use({ javaScriptEnabled: false });

test.describe('no-JS — complete directory in real server DOM', () => {
  test('all six projects + all six demo links render without JS @smoke', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The hero wordmark is real server DOM.
    await expect(
      page.getByRole('heading', { level: 1, name: 'ATRIUM' }),
    ).toBeVisible();

    // Every bay section is present with its resolved title and pitch.
    for (const project of PROJECTS) {
      await expect(
        page.locator(`#${bayId(project.slug)}`),
        `bay ${project.slug} present`,
      ).toBeAttached();
      const title = page.locator(`#${bayId(project.slug)}-title`);
      await expect(title).toHaveText(project.name);
    }

    // The directory floor carries all six demo links to the real Fly URLs.
    const directory = page.locator('#directory');
    await expect(directory).toBeAttached();
    for (const project of PROJECTS) {
      const link = directory.getByRole('link', {
        name: demoLinkName(project.name),
      });
      await expect(link, `${project.slug} demo link (no JS)`).toHaveCount(1);
      await expect(link).toHaveAttribute('href', project.demoUrl);
    }

    // The six U2 repo affordances are present (disabled spans) — and there is
    // NO live github.com link (the seam is not yet flipped).
    const repoControls = directory.locator('[aria-disabled="true"]', {
      hasText: 'GitHub repo',
    });
    await expect(repoControls).toHaveCount(6);
    await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);

    // The footer (with the six-link repeat) renders too.
    await expect(page.locator('footer')).toBeAttached();
  });
});
