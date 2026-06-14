import { expect, test } from '@playwright/test';

/**
 * The SEO surface (PLAN Phase 7 + the Lighthouse SEO criterion). The
 * frontend-engineer's SEO pass shipped: per-page metadata + canonical,
 * robots.txt, sitemap.xml, a designed next/og OG image, and Person + WebSite +
 * CreativeWork JSON-LD. These assertions confirm the surface resolves against
 * the production build so the Lighthouse SEO category can clear ≥ 95.
 */
test.describe('SEO surface — robots, sitemap, OG image, JSON-LD, canonical', () => {
  test('/robots.txt resolves and points at the sitemap @smoke', async ({
    request,
  }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const body = await res.text();
    expect(body).toMatch(/sitemap/i);
  });

  test('/sitemap.xml resolves as XML and lists / and /about @smoke', async ({
    request,
  }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toMatch(/<loc>[^<]*\/<\/loc>/);
    expect(body).toMatch(/\/about/);
  });

  test('/opengraph-image returns a PNG @smoke', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('the home page carries Person + WebSite + CreativeWork JSON-LD', async ({
    page,
  }) => {
    await page.goto('/?tier=low', { waitUntil: 'domcontentloaded' });

    const ldScripts = page.locator('script[type="application/ld+json"]');
    await expect(ldScripts).toHaveCount(1);

    const raw = await ldScripts.first().textContent();
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { '@graph'?: { '@type'?: string }[] };
    expect(Array.isArray(parsed['@graph'])).toBe(true);

    const types = (parsed['@graph'] ?? []).map((node) => node['@type']);
    expect(types).toContain('WebSite');
    expect(types).toContain('Person');
    expect(types).toContain('CreativeWork');
  });

  test('the home page carries a canonical link + meta description', async ({
    page,
  }) => {
    await page.goto('/?tier=low', { waitUntil: 'domcontentloaded' });
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);

    const desc = page.locator('meta[name="description"]');
    await expect(desc).toHaveCount(1);
    await expect(desc).toHaveAttribute('content', /.+/);

    // The OG image meta references the designed OG route on the origin.
    const og = page.locator('meta[property="og:image"]');
    await expect(og.first()).toHaveAttribute('content', /opengraph-image/);
  });

  test('/about carries its own canonical + CreativeWork JSON-LD', async ({
    page,
  }) => {
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);

    const raw = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const parsed = JSON.parse(raw!) as { '@type'?: string };
    expect(parsed['@type']).toBe('CreativeWork');
  });
});
