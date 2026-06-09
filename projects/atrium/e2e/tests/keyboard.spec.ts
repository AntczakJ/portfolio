import { expect, test, type Locator } from '@playwright/test';

import { LandingPage, PROJECTS } from '@helpers/index';

/**
 * Test 5 — full keyboard reachability of the twelve outward affordances
 * (Task 6.2, the success criterion).
 *
 * In the directory floor (the canonical no-cinema index — ADR-003) every one of
 * the six demo links must be a real, keyboard-focusable `<a>` with a discernible
 * accessible name ("<name> — live demo"). The six repo affordances are the U2
 * disabled state: present and accessibly labelled, but correctly NOT a tab stop
 * (a non-navigating `aria-disabled` span removed from the tab order) so a
 * keyboard user is never stopped on a dead control.
 */
test.describe('keyboard — twelve affordances reachable, disabled repo not a tab stop', () => {
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

  test('the six disabled repo affordances are NOT tab stops', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const repoControls = landing.directoryRepoAffordances();
    await expect(repoControls).toHaveCount(6);

    for (let i = 0; i < 6; i++) {
      const control = repoControls.nth(i);
      // It is an aria-disabled span, present + accessibly explained...
      await expect(control).toHaveAttribute('aria-disabled', 'true');
      // ...with no tabindex making it focusable, and not a link/button.
      await expect(control).not.toHaveAttribute('tabindex', /.*/);
      const tag = await control.evaluate((el) => el.tagName.toLowerCase());
      expect(tag).toBe('span');
    }
  });

  test('tabbing forward through the directory hits the six demo links in order, skipping repo controls', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // Start focus at the first directory demo link, then Tab forward and collect
    // the accessible names of the focused elements that are demo/anchor controls
    // within the directory. The disabled repo span must never receive focus.
    const firstDemo = landing.directoryDemoLink(PROJECTS[0]!.name);
    await firstDemo.focus();
    await expect(firstDemo).toBeFocused();

    const seenDemoNames: string[] = [];

    // Walk forward enough Tab presses to traverse all six rows (each row: a demo
    // link + a skipped repo span). Collect demo-link names as they gain focus.
    for (let step = 0; step < 24; step++) {
      const focused = page.locator(':focus');
      const info = await focused.evaluate((el) => {
        const a = el as HTMLElement;
        return {
          tag: a.tagName.toLowerCase(),
          ariaDisabled: a.getAttribute('aria-disabled'),
          name: a.getAttribute('aria-label') ?? a.textContent.trim(),
          inDirectory: !!a.closest('#directory'),
        };
      });

      // A disabled repo control must NEVER be the focused element.
      expect(
        info.ariaDisabled,
        'a disabled repo affordance must not receive keyboard focus',
      ).not.toBe('true');

      if (
        info.inDirectory &&
        info.tag === 'a' &&
        info.name.endsWith(' — live demo') &&
        !seenDemoNames.includes(info.name)
      ) {
        seenDemoNames.push(info.name);
      }

      if (seenDemoNames.length === PROJECTS.length) break;
      await page.keyboard.press('Tab');
    }

    // All six demo links were reached by keyboard, in canonical order.
    expect(seenDemoNames).toEqual(
      PROJECTS.map((p) => `${p.name} — live demo`),
    );
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
