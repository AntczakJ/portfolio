import { expect, test } from '@playwright/test';

import { GITHUB_BASE, PROJECTS, repoUrl } from '@helpers/index';

/**
 * Test 7 — the SEO surface (Task 6.2 support for the Lighthouse SEO criterion).
 *
 * atrium is the portfolio's front page, so SEO matters most here. The
 * frontend-engineer's SEO pass (AGENT_NOTES) shipped: primary metadata + a
 * canonical, robots.txt, sitemap.xml, a designed OG image, and JSON-LD. These
 * assertions confirm the surface resolves against the production build so the
 * Lighthouse SEO category can clear ≥ 95.
 */
test.describe('SEO surface — robots, sitemap, OG image, JSON-LD', () => {
  test('/robots.txt resolves and points at the sitemap @smoke', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/sitemap/i);
  });

  test('/sitemap.xml resolves as XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
  });

  test('/opengraph-image returns a PNG', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('the home page carries one JSON-LD block listing the six projects @smoke', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ldScripts = page.locator('script[type="application/ld+json"]');
    await expect(ldScripts).toHaveCount(1);

    const raw = await ldScripts.first().textContent();
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { '@graph'?: unknown[] };
    expect(Array.isArray(parsed['@graph'])).toBe(true);

    // The six projects appear as structured-data items with their real demo URLs.
    const flat = JSON.stringify(parsed);
    for (const project of PROJECTS) {
      expect(flat, `${project.slug} demo URL in JSON-LD`).toContain(
        project.demoUrl,
      );
    }

    // The GITHUB_BASE seam is flipped (the repo is public + pushed), so the
    // structured data now carries the repo links it gates on REPO_LINKS_LIVE:
    // each SoftwareApplication's `codeRepository` is its monorepo deep-link, and
    // the author's `sameAs` is the repo root (the GitHub profile/org base).
    for (const project of PROJECTS) {
      expect(flat, `${project.slug} codeRepository in JSON-LD`).toContain(
        `"codeRepository":"${repoUrl(project.slug)}"`,
      );
    }
    expect(flat, 'author sameAs in JSON-LD').toContain(
      `"sameAs":["${GITHUB_BASE}"]`,
    );
  });

  test('the home page carries a canonical link + meta description', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    const desc = page.locator('meta[name="description"]');
    await expect(desc).toHaveCount(1);
    await expect(desc).toHaveAttribute('content', /.+/);
  });
});
