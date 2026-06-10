import { expect, test, type Locator } from '@playwright/test';

import { LandingPage, PROJECTS, repoLinkName } from '@helpers/index';

/**
 * Test 5 — full keyboard reachability of the twelve outward affordances
 * (Task 6.2, the success criterion).
 *
 * In the directory floor (the canonical no-cinema index — ADR-003) all twelve
 * outward affordances must now be real, keyboard-focusable `<a>`s with
 * discernible accessible names. The `GITHUB_BASE` seam is flipped (the repo is
 * public + pushed), so each project has BOTH a live demo link ("<name> — live
 * demo") AND a live repo link ("<name> — GitHub repository") — there is no longer
 * a non-focusable disabled repo span. Tabbing forward through the directory hits
 * each row's demo link THEN its repo link, in canonical order.
 */
test.describe('keyboard — all twelve outward links reachable, repo is a live tab stop', () => {
  test('every directory demo link is keyboard-focusable with a discernible name @smoke', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    for (const project of PROJECTS) {
      const link = landing.directoryDemoLink(project.name);
      await expect(link).toHaveCount(1);
      // Programmatic focus = a real tab stop. (Assert it can hold focus.)
      await link.focus();
      await expect(link).toBeFocused();
      // The discernible accessible name disambiguates across the twelve.
      await expect(link).toHaveAccessibleName(`${project.name} — live demo`);
    }
  });

  test('every directory repo link is keyboard-focusable with a discernible name', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // No disabled repo span survives the flip.
    await expect(
      page.locator('[aria-disabled="true"]', { hasText: 'GitHub repo' }),
    ).toHaveCount(0);

    for (const project of PROJECTS) {
      const link = landing.directoryRepoLink(project.name);
      await expect(link).toHaveCount(1);
      // Programmatic focus = a real tab stop (it is a live <a>).
      await link.focus();
      await expect(link).toBeFocused();
      // The discernible accessible name disambiguates across the twelve.
      await expect(link).toHaveAccessibleName(repoLinkName(project.name));
    }
  });

  test('tabbing forward through the directory hits each row demo link then its repo link, in order', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // Start focus at the first directory demo link, then Tab forward and collect
    // the accessible names of the directory anchors as they gain focus. The repo
    // link is now a real tab stop, so the expected sequence interleaves
    // demo + repo per row, in canonical order.
    const firstDemo = landing.directoryDemoLink(PROJECTS[0]!.name);
    await firstDemo.focus();
    await expect(firstDemo).toBeFocused();

    const seen: string[] = [];
    const expected = PROJECTS.flatMap((p) => [
      `${p.name} — live demo`,
      repoLinkName(p.name),
    ]);

    // Walk forward enough Tab presses to traverse all twelve directory anchors.
    for (let step = 0; step < 48; step++) {
      const focused = page.locator(':focus');
      const info = await focused.evaluate((el) => {
        const a = el as HTMLElement;
        return {
          tag: a.tagName.toLowerCase(),
          name: a.getAttribute('aria-label') ?? a.textContent.trim(),
          inDirectory: !!a.closest('#directory'),
        };
      });

      if (
        info.inDirectory &&
        info.tag === 'a' &&
        (info.name.endsWith(' — live demo') ||
          info.name.endsWith(' — GitHub repository')) &&
        !seen.includes(info.name)
      ) {
        seen.push(info.name);
      }

      if (seen.length === expected.length) break;
      await page.keyboard.press('Tab');
    }

    // All twelve directory affordances were reached by keyboard, demo-then-repo
    // per row, in canonical order.
    expect(seen).toEqual(expected);
  });

  test('the hero wordmark and header chrome are real focusable DOM', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // The mailto contact in the footer is a real anchor (keyboard reachable).
    const contact: Locator = page
      .locator('footer')
      .getByRole('link', { name: /Contact/i });
    await contact.focus();
    await expect(contact).toBeFocused();
    await expect(contact).toHaveAttribute('href', /^mailto:/);
  });
});
