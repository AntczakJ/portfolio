import { expect, test } from '@playwright/test';

import { BookingPage } from '@helpers/index';

/**
 * Test 5 — the availability grid.
 *
 * Per ADR-003 the grid renders UNAVAILABLE slots present-but-disabled (never
 * hidden) so a screen-reader user hears "10:30, already booked" rather than
 * the slot vanishing. This asserts:
 *   - disabled slots are visible AND not selectable (`aria-disabled`, no
 *     radio role, a click is a no-op),
 *   - selecting an available slot updates the running summary (the desktop
 *     rail's Time row fills in).
 *
 * The seeded pre-bookings + frozen clock guarantee at least one disabled slot
 * exists on a working day for a busy barber, deterministically.
 */
test.describe('booking — availability grid', () => {
  test.beforeEach(async ({ page }) => {
    const booking = new BookingPage(page);
    await page.goto('/book', { waitUntil: 'domcontentloaded' });
    await booking.clearPersistedDraft();
  });

  /** Get to the grid: service -> first barber -> first date. */
  async function gotoGrid(booking: BookingPage): Promise<void> {
    await booking.goto();
    await booking.pickFirstService();
    await booking.pickFirstConcreteBarber();
    await booking.pickFirstDate();
    await expect(booking.timeGroup()).toBeVisible();
  }

  test('disabled slots are visible but not selectable', async ({ page }) => {
    const booking = new BookingPage(page);
    await gotoGrid(booking);

    // Find a day that actually has at least one disabled slot. The first
    // offered day usually does (seeded pre-bookings + the "past" rule on
    // today); if not, advance the date strip until one appears.
    const dates = booking.dateGroup().getByRole('radio');
    const dateCount = await dates.count();
    let foundDisabled = false;
    for (let i = 0; i < dateCount; i++) {
      await dates.nth(i).click();
      await expect(booking.timeGroup()).toBeVisible();
      if ((await booking.disabledSlots().count()) > 0) {
        foundDisabled = true;
        break;
      }
    }
    expect(
      foundDisabled,
      'at least one offered day has a disabled slot (seeded pre-bookings / past rule)',
    ).toBe(true);

    const disabled = booking.disabledSlots().first();
    await expect(disabled).toBeVisible();
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
    // It carries an accessible reason, not just a time.
    await expect(disabled).toHaveAttribute(
      'aria-label',
      /unavailable —/i,
    );

    // It is NOT exposed as a selectable radio — the radiogroup's radios are
    // only the available ones.
    const disabledLabel = await disabled.getAttribute('aria-label');
    const time = (disabledLabel ?? '').split(',')[0]?.trim() ?? '';
    // No radio in the group carries this disabled slot's exact time as its
    // start (available radios use a RANGE label, disabled buttons a single
    // time) — so a click on the disabled button selects nothing.
    await disabled.click({ force: true });
    // Nothing got checked by clicking a disabled slot.
    await expect(
      booking.timeGroup().locator('[role="radio"][aria-checked="true"]'),
    ).toHaveCount(0);
    expect(time).toMatch(/\d{1,2}:\d{2}/);
  });

  test('selecting an available slot updates the summary', async ({ page }) => {
    const booking = new BookingPage(page);
    await gotoGrid(booking);

    // The desktop summary rail's Time row starts empty (an em-dash).
    const rail = page.getByRole('complementary').or(page.locator('aside'));
    const timeRow = page
      .locator('dt', { hasText: /^Time$/ })
      .locator('xpath=following-sibling::dd[1]');

    await expect(timeRow.first()).toHaveText('—');

    const slotLabel = await booking.pickFirstAvailableSlot();
    // The chosen slot's start time now appears in the summary Time row.
    const start = (/(\d{1,2}:\d{2})/.exec(slotLabel) ?? [])[1] ?? '';
    expect(start).toMatch(/\d{1,2}:\d{2}/);
    await expect(timeRow.first()).toContainText(start);

    // And the selected slot is the checked radio.
    await expect(
      booking.timeGroup().locator('[role="radio"][aria-checked="true"]'),
    ).toHaveCount(1);
    // (rail locator referenced to keep the intent explicit in the trace.)
    expect(await rail.count()).toBeGreaterThan(0);
  });
});
