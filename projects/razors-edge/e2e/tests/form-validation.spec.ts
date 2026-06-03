import { expect, test } from '@playwright/test';

import { BookingPage } from '@helpers/index';

/**
 * Test 4 — details-step form validation.
 *
 * The "Your details" step is react-hook-form + zodResolver over the shared
 * `contactDetailsSchema`. It must block advance on invalid input and surface
 * accessible errors (wired via `aria-invalid` + `aria-describedby` per
 * docs/conventions § 5). We cover the success path implicitly (the happy-path
 * spec) and here the three most common failure modes:
 *   1. empty required fields,
 *   2. a malformed email,
 *   3. a too-short / malformed phone.
 */
test.describe('booking — details validation', () => {
  /** Walk to the details step from a fresh wizard. */
  async function gotoDetailsStep(booking: BookingPage): Promise<void> {
    await booking.goto();
    await booking.pickFirstService();
    await booking.pickFirstConcreteBarber();
    await booking.pickFirstDate();
    await booking.pickFirstAvailableSlot();
    await booking.continueButton().click();
    await expect(booking.detailsForm()).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    const booking = new BookingPage(page);
    await page.goto('/book', { waitUntil: 'domcontentloaded' });
    await booking.clearPersistedDraft();
  });

  test('empty required fields block advance and surface accessible errors', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await gotoDetailsStep(booking);

    // Submit with everything empty.
    await booking.confirmButton().click();

    // We are still on the details step (no confirmation).
    await expect(booking.confirmedHeading()).toHaveCount(0);
    await expect(booking.detailsForm()).toBeVisible();

    // Required fields are flagged invalid + carry a described-by error.
    await expect(booking.nameInput()).toHaveAttribute('aria-invalid', 'true');
    await expect(booking.emailInput()).toHaveAttribute('aria-invalid', 'true');
    await expect(booking.phoneInput()).toHaveAttribute('aria-invalid', 'true');

    // The accessible error text is visible (connected via aria-describedby).
    await expect(page.getByText('Please enter your name')).toBeVisible();
    await expect(page.getByText('Please enter your email')).toBeVisible();
  });

  test('a malformed email is rejected with a connected error', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await gotoDetailsStep(booking);

    await booking.fillDetails({
      name: 'Tomasz Antczak',
      email: 'not-an-email',
      phone: '+48 600 100 200',
    });
    await booking.confirmButton().click();

    await expect(booking.confirmedHeading()).toHaveCount(0);
    await expect(booking.emailInput()).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Please enter a valid email')).toBeVisible();

    // The error is wired to the input via aria-describedby.
    const describedBy =
      await booking.emailInput().getAttribute('aria-describedby');
    expect(describedBy, 'email input describes its error node').toBeTruthy();
    // `toBeTruthy` above guarantees a non-null id; narrow it for the selector.
    await expect(page.locator(`#${describedBy ?? ''}`)).toHaveText(
      /valid email/i,
    );
  });

  test('a malformed phone is rejected', async ({ page }) => {
    const booking = new BookingPage(page);
    await gotoDetailsStep(booking);

    await booking.fillDetails({
      name: 'Tomasz Antczak',
      email: 'tomasz@example.com',
      phone: 'abc', // letters are not allowed by the schema regex
    });
    await booking.confirmButton().click();

    await expect(booking.confirmedHeading()).toHaveCount(0);
    await expect(booking.phoneInput()).toHaveAttribute('aria-invalid', 'true');
  });
});
