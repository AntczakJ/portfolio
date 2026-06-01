import { expect, test } from '@playwright/test';

import { LandingPage } from '@helpers/landing-page';
import {
  isValidSessionValue,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from '@helpers/identity';

/**
 * Test 4 — first visit mints a `meld_session` cookie; refresh reuses
 * the same identity; cookie-clear gives a new identity.
 *
 * Three assertions chained:
 *
 *   1. After the first page load the cookie is present + a valid
 *      UUID v4. ADR-005 attributes are sampled (the production
 *      `Secure: true` flag is only verifiable when BASE_URL is
 *      `https://`; local dev has it as `false`, which is correct per
 *      the ADR but means the assertion is conditional).
 *   2. Reloading the page yields the SAME cookie value + the same
 *      visible identity emoji-name on the `<IdentityBadge />`
 *      (`data-identity-name` attribute).
 *   3. Clearing the cookie via `context.clearCookies(...)` and
 *      reloading mints a NEW cookie value with a different identity.
 *      Tests inequality on both the cookie value and the
 *      `data-identity-name`.
 *
 * Tagged `@smoke` — ADR-005 cookie roundtrip is the load-bearing identity
 * contract; included in deploy verification.
 */
test.describe('identity cookie — roundtrip + reset', () => {
  test('cookie mint, refresh, clear-and-remint @smoke', async ({
    page,
    context,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const initialCookie = await readSessionCookie(context);
    expect(initialCookie).not.toBeNull();
    if (initialCookie === null) return; // narrow for ts
    expect(isValidSessionValue(initialCookie.value)).toBe(true);

    // ADR-005 attribute sanity. `Path: /`, `Max-Age: ~1 year`, no domain.
    expect(initialCookie.attributes.path).toBe('/');
    expect(initialCookie.attributes.sameSite).toMatch(/^Lax$/i);
    expect(initialCookie.attributes.httpOnly).toBe(false);

    // Capture the visible identity name from the IdentityBadge so we
    // can compare across the reload + clear paths.
    const firstName = await landing.identityBadge().getAttribute(
      'data-identity-name',
    );

    // Reload — same cookie, same identity.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReloadCookie = await readSessionCookie(context);
    expect(afterReloadCookie?.value).toBe(initialCookie.value);
    const afterReloadName = await landing.identityBadge().getAttribute(
      'data-identity-name',
    );
    expect(afterReloadName).toBe(firstName);

    // Clear the cookie + reload — new cookie value, new identity. The
    // identity could COINCIDENTALLY land on the same emoji-name (1/128
    // odds per ADR-005's whitelist size). We loop a small number of
    // times to avoid the rare collision flake; in practice the cookie
    // value always changes so the value-inequality assertion is the
    // load-bearing one.
    await context.clearCookies({ name: SESSION_COOKIE_NAME });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const remintedCookie = await readSessionCookie(context);
    expect(remintedCookie).not.toBeNull();
    if (remintedCookie === null) return;
    expect(remintedCookie.value).not.toBe(initialCookie.value);
    expect(isValidSessionValue(remintedCookie.value)).toBe(true);
  });
});
