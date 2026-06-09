import { expect, test } from '@playwright/test';

import { PROJECTS } from '@helpers/index';

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

    // U2 honesty: while the placeholder GITHUB_BASE is in force, no github.com
    // link is emitted into the structured data (no broken codeRepository/sameAs).
    expect(flat).not.toContain('github.com');
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
