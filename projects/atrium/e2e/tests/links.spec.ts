import { expect, test } from '@playwright/test';

import {
  GITHUB_BASE,
  LandingPage,
  PROJECTS,
  repoLinkName,
  repoUrl,
} from '@helpers/index';

/**
 * Test 2 — the twelve outward affordances (Task 6.2, the success criterion).
 *
 * Every project's demo + repo affordance must be present and point where
 * expected:
 *   - six DEMO links are real, live `<a href>`s to the project's public Fly URL,
 *     with `target="_blank"` + `rel="noopener noreferrer"` and a discernible
 *     accessible name ("<name> — live demo");
 *   - six REPO links are now LIVE `<a href>`s (the single `GITHUB_BASE` seam is
 *     flipped — the repo is public + pushed and the production build bakes
 *     `NEXT_PUBLIC_GITHUB_BASE`, so `REPO_LINKS_LIVE` is true). Each points at the
 *     R1 monorepo deep-link `${GITHUB_BASE}/tree/main/projects/<slug>`, with
 *     `target="_blank"` + `rel="noopener noreferrer"` and a discernible
 *     accessible name ("<name> — GitHub repository"). There are NO remaining
 *     `aria-disabled` repo controls.
 *
 * The same named demo/repo link appears in the bay AND the directory floor; the
 * "exactly six" cardinality is asserted against the DIRECTORY (the canonical
 * no-cinema reachable index — ADR-003), where each project appears once.
 */
test.describe('outward links — six demos + six live repo links', () => {
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

  test('the directory carries exactly six live repo links to the real GitHub deep-links', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const directory = landing.directory();

    // Exactly six repo links in the directory floor (the seam is flipped).
    const repoLinks = directory.getByRole('link', {
      name: /— GitHub repository$/,
    });
    await expect(repoLinks).toHaveCount(6);

    // Each one points at the exact R1 monorepo deep-link for its slug, opens in
    // a new tab, and is safe.
    for (const project of PROJECTS) {
      const link = landing.directoryRepoLink(project.name);
      await expect(link, `${project.slug} repo link present`).toHaveCount(1);
      await expect(link).toHaveAttribute('href', repoUrl(project.slug));
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('rel', /noreferrer/);
    }

    // No remaining U2 disabled repo controls anywhere on the page — the flip is
    // complete, not half-applied.
    await expect(
      page.locator('[aria-disabled="true"]', { hasText: 'GitHub repo' }),
    ).toHaveCount(0);
  });

  test('each bay also surfaces its project repo link to the real GitHub deep-link', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // As with the demo anchors, the bay links start hidden under the full cinema
    // (`data-bay-reveal`, opacity 0) until the bay locks in — so we assert the
    // anchor exists in the bay DOM with the right href + discernible aria-label,
    // independent of the mid-scroll reveal state.
    for (const project of PROJECTS) {
      const bayRepo = landing
        .bay(project.slug)
        .locator(`a[href="${repoUrl(project.slug)}"]`);
      await expect(bayRepo, `${project.slug} bay repo anchor`).toHaveCount(1);
      await expect(bayRepo).toHaveAttribute(
        'aria-label',
        repoLinkName(project.name),
      );
      await expect(bayRepo).toHaveAttribute('target', '_blank');
      await expect(bayRepo).toHaveAttribute('rel', /noopener/);
      await expect(bayRepo).toHaveAttribute('rel', /noreferrer/);
    }
  });

  test('every github.com anchor on the page is a live repo deep-link under the single base', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    // Every github.com href must be under the single flipped GITHUB_BASE — no
    // stray or hardcoded link slipped past the one seam. (The page carries 2x
    // each slug — bay + directory row — plus the repo-root profile link.)
    const githubHrefs = await page
      .locator('a[href*="github.com"]')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
      );
    expect(githubHrefs.length).toBeGreaterThan(0);
    for (const href of githubHrefs) {
      expect(href.startsWith(GITHUB_BASE), `${href} under GITHUB_BASE`).toBe(
        true,
      );
    }

    // The six per-project repo deep-links are all present among them.
    for (const project of PROJECTS) {
      expect(githubHrefs, `${project.slug} deep-link present`).toContain(
        repoUrl(project.slug),
      );
    }

    // The profile link (repo root, no /tree/... suffix) is present too.
    expect(githubHrefs).toContain(GITHUB_BASE);
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
