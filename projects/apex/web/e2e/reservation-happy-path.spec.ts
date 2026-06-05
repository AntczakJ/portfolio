import { expect, test, type Page } from '@playwright/test';

/**
 * Reservation HAPPY PATH end-to-end (Task 7.2a).
 *
 * Enters from the home fleet/configurator deep-link with a chosen config →
 * vehicle step reflects the carry-over → date-range + pickup/return → extras +
 * insurance → driver details → confirmation with the reference + the
 * chosen-config render, and asserts the `.ics` downloads.
 *
 * Deterministic against the frozen clock (now = 2026-06-15). Reuses the
 * verify-reserve.mjs patterns: native DOM clicks for the two-pick date path
 * (a programmatic .focus() after the first pick disrupts Playwright's .click()
 * actionability), and a clean-run finder so the path never borders a booking.
 */

const SEED = { vehicle: 'lumen-gt', color: 'col-voltaic', wheels: 'whl-forged' };

/** Find the first run of N consecutive selectable days in the visible calendar. */
async function findCleanRun(page: Page, n: number): Promise<string[]> {
  return page.evaluate((count) => {
    const btns = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[data-day]'),
    );
    const days = btns.map((b) => ({
      day: b.getAttribute('data-day') ?? '',
      ok: !b.hasAttribute('disabled'),
    }));
    for (let i = 0; i <= days.length - count; i += 1) {
      if (days.slice(i, i + count).every((d) => d.ok)) {
        return days.slice(i, i + count).map((d) => d.day);
      }
    }
    return [];
  }, n);
}

test('completes a reservation from a configured deep-link to a downloadable .ics', async ({
  page,
}) => {
  // --- Enter from the fleet/configurator deep-link with a chosen config ------
  await page.goto('/');
  const flagHref = await page
    .locator('a[href*="/reserve?vehicle="][href*="color="]')
    .first()
    .getAttribute('href');
  const deepLink =
    flagHref ?? `/reserve?vehicle=${SEED.vehicle}&color=${SEED.color}&wheels=${SEED.wheels}`;

  await page.goto(deepLink);

  // --- The carry-over: pre-seeded onto the dates step, vehicle chosen --------
  const heading = page.locator('#wizard-step-heading');
  await expect(heading).toContainText(/dates|places/i);

  // No <canvas> on /reserve — the wizard adds no R3F (the bundle guarantee).
  await expect(page.locator('canvas')).toHaveCount(0);

  // The summary rail reflects the carried configuration (the configured hero
  // shows its colour · wheel line; the home flagship deep-link carries the
  // DEFAULT config — Glacier White · Aero — so assert the config line is
  // present, not a specific colour).
  const rail = page.locator('aside').first();
  await expect(rail).toContainText('APEX Lumen SUV');
  await expect(rail).toContainText(/White|Glacier|Voltaic|Graphite|Midnight/i);

  // --- Date range via the keyboard picker (a clean 3-day rental) -------------
  const run = await findCleanRun(page, 3);
  expect(run.length).toBe(3);
  await page.locator(`button[data-day="${run[0] ?? ''}"]`).focus();
  await page.keyboard.press('Enter'); // pick-up
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // return → a 3-day half-open range
  await expect(page.locator('[aria-selected="true"]')).not.toHaveCount(0);

  // --- Pickup + return (different → the one-way fee) -------------------------
  await page.locator('input[name="apex-pickup"]').nth(0).check({ force: true });
  await page.locator('input[name="apex-return"]').nth(1).check({ force: true });

  // The summary total is present and live (aria-live region).
  const total = page.locator('aside [aria-live="polite"]').last();
  const totalBefore = (await total.innerText()).trim();

  await page.getByRole('button', { name: /^Continue$/ }).click();

  // --- Extras + insurance update the live total -----------------------------
  await expect(heading).toContainText(/extras|add/i);
  await page.locator('input[type="checkbox"]').first().check({ force: true });
  await page.locator('input[name="apex-insurance"]').nth(2).check({ force: true });
  // The total must change after adding paid extras + insurance.
  await expect(async () => {
    const after = (await total.innerText()).trim();
    expect(after).not.toBe(totalBefore);
  }).toPass();

  await page.getByRole('button', { name: /^Continue$/ }).click();

  // --- Driver details -------------------------------------------------------
  await expect(heading).toContainText(/driver|details/i);
  await page.fill('#driver-name', 'Ada Lovelace');
  await page.fill('#driver-email', 'ada@example.com');
  await page.fill('#driver-phone', '+44 20 7946 0000');
  await page.fill('#driver-licence', 'LOVEL12345');

  // --- Submit → confirmation with a deterministic reference -----------------
  await page.getByRole('button', { name: /Confirm reservation/ }).click();
  await expect(heading).toContainText(/all set/i);

  const reference = page.locator('text=/APX-[A-Z0-9]{4}-[A-Z0-9]{4}/').first();
  await expect(reference).toBeVisible();

  // The chosen-config render is shown on the confirmation (the spine thread).
  await expect(page.locator('img[alt*="configuration"]')).not.toHaveCount(0);

  // --- The .ics downloads ---------------------------------------------------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Add to calendar/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^apex-apx-[a-z0-9]{4}-[a-z0-9]{4}\.ics$/);
});

test('the booking reference is deterministic for the same inputs (frozen clock)', async ({
  page,
}) => {
  async function runOnce(): Promise<string> {
    await page.goto(`/reserve?vehicle=${SEED.vehicle}&color=${SEED.color}&wheels=${SEED.wheels}`);
    await page.evaluate(() => {
      localStorage.removeItem('apex:reservation-draft');
    });
    await page.goto(`/reserve?vehicle=${SEED.vehicle}&color=${SEED.color}&wheels=${SEED.wheels}`);
    await expect(page.locator('#wizard-step-heading')).toContainText(/dates|places/i);
    const run = await findCleanRun(page, 3);
    await page.locator(`button[data-day="${run[0] ?? ''}"]`).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.locator('input[name="apex-pickup"]').nth(0).check({ force: true });
    await page.locator('input[name="apex-return"]').nth(0).check({ force: true });
    await page.getByRole('button', { name: /^Continue$/ }).click();
    await page.getByRole('button', { name: /^Continue$/ }).click();
    await page.fill('#driver-name', 'Ada Lovelace');
    await page.fill('#driver-email', 'ada@example.com');
    await page.fill('#driver-phone', '+44 20 7946 0000');
    await page.fill('#driver-licence', 'LOVEL12345');
    await page.getByRole('button', { name: /Confirm reservation/ }).click();
    await expect(page.locator('#wizard-step-heading')).toContainText(/all set/i);
    return (await page.locator('text=/APX-/').first().innerText()).trim();
  }

  const first = await runOnce();
  await page.evaluate(() => {
    localStorage.removeItem('apex:reservation-draft');
  });
  const second = await runOnce();
  expect(first).toBe(second);
});

test('persists the chosen range across a reload', async ({ page }) => {
  await page.goto(`/reserve?vehicle=${SEED.vehicle}&color=${SEED.color}&wheels=${SEED.wheels}`);
  await page.evaluate(() => {
    localStorage.removeItem('apex:reservation-draft');
  });
  await page.goto(`/reserve?vehicle=${SEED.vehicle}&color=${SEED.color}&wheels=${SEED.wheels}`);
  await expect(page.locator('#wizard-step-heading')).toContainText(/dates|places/i);

  const run = await findCleanRun(page, 2);
  await page.locator(`button[data-day="${run[0] ?? ''}"]`).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.locator('input[name="apex-pickup"]').nth(0).check({ force: true });
  await page.locator('input[name="apex-return"]').nth(0).check({ force: true });

  await page.reload();
  // The persisted range survives (an ISO date appears in the summary rail).
  await expect(page.locator('aside').first()).toContainText(/\d{4}-\d{2}-\d{2}/);
});
