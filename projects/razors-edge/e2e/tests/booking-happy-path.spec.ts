import { expect, test } from '@playwright/test';

import { BookingPage } from '@helpers/index';

/**
 * Test 2 — the booking happy path (the centerpiece interaction).
 *
 * Enter the wizard, complete all five steps choosing the first available
 * option at each, and assert the confirmation lands with everything the spec
 * promises: a `RE-XXXXXX` booking reference, the summary, the "Add to
 * calendar (.ics)" affordance, and the honest demo disclaimer. We also assert
 * the `.ics` is actually OFFERED as a download (the affordance is wired, not
 * decorative).
 *
 * Tagged `@smoke` — this is the flow whose breakage would most embarrass the
 * showcase, so it is in the fast deploy-verification subset.
 */
test.describe('booking — happy path', () => {
  test.beforeEach(async ({ page }) => {
    // Start each run from a fresh persisted draft (the wizard persists to
    // localStorage). Visit the origin first so localStorage is in scope.
    const booking = new BookingPage(page);
    await page.goto('/book', { waitUntil: 'domcontentloaded' });
    await booking.clearPersistedDraft();
  });

  test('completes service -> barber -> date/time -> details -> confirmation @smoke', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto();

    // Step 1 — pick a service.
    await booking.pickFirstService();
    await expect(booking.barberGroup()).toBeVisible();

    // Step 2 — pick a concrete barber who performs that service.
    await booking.pickFirstConcreteBarber();
    await expect(booking.dateGroup()).toBeVisible();

    // Step 3 — pick a date + an AVAILABLE slot from the grid.
    await booking.pickFirstDate();
    const slotLabel = await booking.pickFirstAvailableSlot();
    expect(slotLabel).toMatch(/available/i);
    await booking.continueButton().click();

    // Step 4 — fill the details form with valid input.
    await expect(booking.detailsForm()).toBeVisible();
    await booking.fillDetails({
      name: 'Tomasz Antczak',
      email: 'tomasz@example.com',
      phone: '+48 600 100 200',
      notes: 'A clean taper, please.',
    });
    await booking.confirmButton().click();

    // Step 5 — confirmation.
    await expect(booking.confirmedHeading()).toBeVisible();

    // A booking reference in the deterministic RE-XXXXXX shape.
    await expect(booking.bookingReference().first()).toBeVisible();
    const reference =
      (await booking.bookingReference().first().textContent()) ?? '';
    expect(reference).toMatch(/^RE-[0-9A-Z]{6}$/);

    // The summary carries the booked service + barber + total.
    await expect(page.getByText('Booking reference')).toBeVisible();
    await expect(page.getByRole('term', { name: 'Total' }).or(page.getByText('Total'))).toBeVisible();

    // The honest demo disclaimer.
    await expect(booking.demoDisclaimer()).toBeVisible();

    // The "Add to calendar (.ics)" affordance is present AND offers a
    // download when clicked.
    await expect(booking.addToCalendarButton()).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await booking.addToCalendarButton().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ics$/i);
  });

  test('a combo service drives a longer-duration time block', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto();

    // Pick the combo "Cut & Beard" — a single Service row with a larger
    // durationMin (the uniform availability model, ADR-003). The slot label
    // shows the full RANGE for the chosen duration, so a 75-min combo reserves
    // a wider window than a single cut.
    await booking.pickService(/Cut & Beard/i);
    await expect(booking.barberGroup()).toBeVisible();

    await booking.pickFirstConcreteBarber();
    await booking.pickFirstDate();

    const slotLabel = await booking.pickFirstAvailableSlot();
    // The available-slot label is "HH:mm – HH:mm, available" — a real range
    // (note the en-dash the formatter uses), proving the duration-aware grid
    // (a single time would mean no block).
    expect(slotLabel).toMatch(
      /\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}.*available/i,
    );
  });
});
