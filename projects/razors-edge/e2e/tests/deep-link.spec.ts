import { expect, test } from '@playwright/test';

import {
  BARBER_MARCO,
  BookingPage,
  INVALID_ID,
  SERVICE_SIGNATURE_CUT,
} from '@helpers/index';

/**
 * Test 3 — deep-link preselect (`/book?service=…` / `?barber=…`).
 *
 * The marketing page's service rows and barber cards link into the wizard
 * pre-seeded (ADR-003). The seed validates ids against the catalog, drops an
 * incompatible seeded barber (keeping the service), and advances the wizard
 * past the satisfied stages. An UNKNOWN id is ignored gracefully — no crash,
 * the wizard starts clean.
 *
 * The wizard persists to localStorage, so each case clears the draft first;
 * the seed only applies to a FRESH wizard (`seedIfEmpty`).
 */
test.describe('booking — deep-link preselect', () => {
  test.beforeEach(async ({ page }) => {
    const booking = new BookingPage(page);
    await page.goto('/book', { waitUntil: 'domcontentloaded' });
    await booking.clearPersistedDraft();
  });

  test('?service=<id> preselects the service and advances to the barber step', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto(`?service=${SERVICE_SIGNATURE_CUT.id}`);

    // Seeding a known service advances the earliest-incomplete step to
    // "barber" — so the barber radiogroup is the one on screen.
    await expect(booking.barberGroup()).toBeVisible();
    await expect(booking.stepHeading()).toHaveText(/Whose chair/i);
  });

  test('?barber=<id> preselects the barber without crashing', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto(`?barber=${BARBER_MARCO.id}`);

    // With only a barber seeded the service is still incomplete, so the
    // service step gates forward progress — the wizard shows step one and is
    // operable (the barber is held provisionally). The key assertion is that
    // a barber-only deep link does not error.
    await expect(booking.serviceGroup()).toBeVisible();
    await expect(booking.stepHeading()).toBeVisible();
  });

  test('an invalid id is ignored gracefully and the wizard starts clean', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto(`?service=${INVALID_ID}&barber=${INVALID_ID}`);

    // Unknown ids are dropped server-side + in the seed → a clean step one.
    await expect(booking.serviceGroup()).toBeVisible();
    await expect(booking.stepHeading()).toHaveText(/What are you in for/i);

    // And it is still fully operable from clean — pick a service to prove it.
    await booking.pickFirstService();
    await expect(booking.barberGroup()).toBeVisible();
  });
});
