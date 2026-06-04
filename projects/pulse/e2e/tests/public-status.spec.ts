import { expect, test } from '@playwright/test';

import {
  PublicStatusPage,
  apiBaseUrl,
  attachDiagnostics,
  demoStatusSlug,
} from '@helpers/index';

/**
 * Test 6 — the public status page (`/status/<slug>`) + the redaction E2E.
 *
 * The public page is the SEO-bearing surface and the privacy boundary. It must:
 *   - render the redacted public monitor (status + 30-day uptime %) and the
 *     recent-incident timeline,
 *   - carry an SSR FLOOR (the hero/status present in the initial HTML, no
 *     client-only data dependency for first paint),
 *   - live-update off the redacted public SSE stream,
 *   - leak NOTHING private: no raw response-time numbers, no private monitor
 *     names ("Cloudflare CDN" / "Example"), no internal "wow-moment target"
 *     label, no alert/secret data,
 *   - and the banner must NOT say "All systems operational" while an incident is
 *     open (the C-3 fix — the banner cannot lie).
 *
 * Tagged `@smoke` — the public page is a deploy SEO surface and a hard gate.
 */
test.describe('public status page — render + SSR floor + redaction', () => {
  test('SSR floor: the status is in the initial HTML (no JS) @smoke', async ({
    request,
  }) => {
    // Fetch the raw HTML (no browser JS) — the redacted content must be present
    // server-side for the crawler (the Lighthouse / SEO posture).
    const res = await request.get(`/status/${demoStatusSlug()}`);
    expect(res.ok()).toBe(true);
    const html = await res.text();

    // The public monitor name and a banner headline are in the SSR HTML.
    expect(html).toContain('Checkout API');
    expect(html).toMatch(
      /All systems operational|Degraded performance|Active outage/,
    );
    // SEO surface: a canonical + JSON-LD are present in the SSR head/body.
    expect(html).toContain('application/ld+json');
    expect(html.toLowerCase()).toContain('canonical');
  });

  test('renders the redacted page, live indicator, and leaks nothing @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    const status = new PublicStatusPage(page);
    await status.goto();

    // The overall banner + the public monitor render.
    await expect(status.overallBanner()).toBeVisible();
    await expect(status.headline()).toBeVisible();
    await expect(status.monitorRow('Checkout API')).toBeVisible();

    // The 30-day uptime % shows (mono number) — the only metric the public
    // surface exposes for a monitor.
    await expect(status.servicesSection()).toContainText(/%/);

    // The page holds a persistent public EventSource, so it never reaches
    // `networkidle`; give any live SSE-driven refetch a brief settle window
    // (the redacted snapshot is the source of truth) before the leak scan.
    await page.waitForTimeout(2_000);

    const body = await status.bodyText();

    // --- REDACTION assertions ---
    // No PRIVATE monitor leaks onto the public page.
    expect(body, 'private monitor "Cloudflare CDN" must not leak').not.toContain(
      'Cloudflare CDN',
    );
    expect(body, 'private monitor "Example" must not leak').not.toMatch(
      /\bExample\b/,
    );
    // The internal demo label must NEVER reach the public surface.
    expect(body).not.toMatch(/wow-moment target/i);
    // No raw response-time leak. The redacted shape has no response-time field,
    // so a "<n> ms" response-time string must not appear on the public page.
    expect(
      body,
      'raw response times must not leak onto the public page',
    ).not.toMatch(/\b\d{1,5}\s?ms\b/);

    // CSP/console clean under the production CSP.
    expect(diag.cspViolations, diag.cspViolations.join('\n')).toEqual([]);
    expect(diag.pageErrors.map((e) => e.message)).toEqual([]);
  });

  test('the public API payload itself carries only the redacted subset', async ({
    request,
  }) => {
    // Belt-and-braces on the contract the page renders: the public read endpoint
    // must not serialize any private field (defence in depth — the shape has no
    // response-time field, so a private field cannot leak).
    const res = await request.get(`${apiBaseUrl()}/public/${demoStatusSlug()}`);
    expect(res.ok()).toBe(true);
    const raw = await res.text();

    for (const forbidden of [
      'targetUrl',
      'responseTimeMs',
      'response_time',
      'userId',
      'user_id',
      'secret',
      'statusCode',
      'status_code',
      'Cloudflare CDN',
      'wow-moment target',
    ]) {
      expect(raw, `public payload must not contain "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  test('the banner does not say "All systems operational" while an incident is open', async ({
    page,
    request,
  }) => {
    // Read the current overall state from the API.
    const apiRes = await request.get(`${apiBaseUrl()}/public/${demoStatusSlug()}`);
    const payload = (await apiRes.json()) as {
      overall: 'operational' | 'degraded' | 'outage';
      incidents: { status: string }[];
    };
    const hasOpen = payload.incidents.some((i) => i.status === 'open');

    const status = new PublicStatusPage(page);
    await status.goto();
    await expect(status.headline()).toBeVisible();
    const headline = (await status.headline().innerText()).trim();

    if (hasOpen || payload.overall !== 'operational') {
      // The banner must reflect the impairment — never the green "all clear".
      expect(
        headline,
        'the banner must not lie while an incident is open (C-3)',
      ).not.toMatch(/All systems operational/i);
      expect(headline).toMatch(/Degraded performance|Active outage/i);
    } else {
      // No open incident: the banner reads operational (the happy floor).
      expect(headline).toMatch(/All systems operational/i);
    }
  });
});
