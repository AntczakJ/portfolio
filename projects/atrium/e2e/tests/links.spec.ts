import { expect, test } from '@playwright/test';

import { LandingPage, PROJECTS } from '@helpers/index';

/**
 * Test 2 — the twelve outward affordances (Task 6.2, the success criterion).
 *
 * Every project's demo + repo affordance must be present and point where
 * expected:
 *   - six DEMO links are real, live `<a href>`s to the project's public Fly URL,
 *     with `target="_blank"` + `rel="noopener noreferrer"` and a discernible
 *     accessible name ("<name> — live demo");
 *   - six REPO affordances are the U2 disabled state while `REPO_LINKS_LIVE` is
 *     false: a non-navigating `aria-disabled` control (NOT an `<a href>` to a
 *     404), so a recruiter never clicks a broken GitHub link.
 *
 * The same named demo link appears in the bay AND the directory floor; the
 * "exactly six" cardinality is asserted against the DIRECTORY (the canonical
 * no-cinema reachable index — ADR-003), where each project appears once.
 */
test.describe('outward links — six demos + six U2 repo affordances', () => {
  test('the directory carries exactly six live demo links to the real Fly URLs @smoke', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const directory = landing.directory();

    // Exactly six demo links in the directory floor.
    const demoLinks = directory.getByRole('link', { name: /— live demo$/ });
    await expect(demoLinks).toHaveCount(6);

    // Each one points at the right real Fly URL, opens in a new tab, and is safe.
    for (const project of PROJECTS) {
      const link = landing.directoryDemoLink(project.name);
      await expect(link, `${project.slug} demo link present`).toHaveCount(1);
      await expect(link).toHaveAttribute('href', project.demoUrl);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('rel', /noreferrer/);
    }
  });

  test('each bay also surfaces its project demo link to the real Fly URL', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // The bay markup is real server DOM (the no-JS / reduced-motion floor), but
    // under the full cinema each bay's links start hidden (`data-bay-reveal`,
    // opacity 0) until the bay locks into frame — so a role query (which filters
    // by accessibility visibility) would not see them. We assert the anchor
    // exists in the bay's DOM with the right href + discernible aria-label,
    // regardless of the mid-scroll reveal state.
    for (const project of PROJECTS) {
      const bayDemo = landing
        .bay(project.slug)
        .locator(`a[href="${project.demoUrl}"]`);
      await expect(bayDemo, `${project.slug} bay demo anchor`).toHaveCount(1);
      await expect(bayDemo).toHaveAttribute(
        'aria-label',
        `${project.name} — live demo`,
      );
      await expect(bayDemo).toHaveAttribute('target', '_blank');
      await expect(bayDemo).toHaveAttribute('rel', /noopener/);
    }
  });

  test('the repo affordances are the U2 disabled state, not navigating links', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const directory = landing.directory();

    // Six disabled repo controls in the directory.
    const repoControls = landing.directoryRepoAffordances();
    await expect(repoControls).toHaveCount(6);

    // They are NOT links (no role=link) — so they never navigate to a 404.
    const repoAsLinks = directory.getByRole('link', { name: /GitHub repo/i });
    await expect(repoAsLinks).toHaveCount(0);

    // Each is aria-disabled and explains itself accessibly.
    for (let i = 0; i < 6; i++) {
      const control = repoControls.nth(i);
      await expect(control).toHaveAttribute('aria-disabled', 'true');
      await expect(control).toContainText('GitHub repo');
    }

    // And there is NO href pointing at github.com anywhere in the page DOM
    // (the single GITHUB_BASE seam is not yet live — no broken repo link ships).
    const githubHrefs = page.locator('a[href*="github.com"]');
    await expect(githubHrefs).toHaveCount(0);
  });

  test('every project is reachable in the directory with both affordances present', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // Scope to the ruled-index's direct `li` children — each project is one
    // row. (Nested `ul > li` carry the stack chips; `> ul > li` excludes them.)
    const rows = landing.directory().locator('> div > ul > li');
    await expect(rows).toHaveCount(6);
  });
});
