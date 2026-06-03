import { expect, test } from '@playwright/test';

import { BookingPage } from '@helpers/index';

/**
 * Test 6 — keyboard operability of the booking flow.
 *
 * The slot grid + the step controls are built as ARIA widgets, so the flow
 * is meant to be fully operable without a mouse. Writing this suite SURFACED
 * TWO real keyboard-a11y defects in the production build (reported to the
 * main thread; tracked here as `test.fixme` so they are visible and un-faked,
 * not silently skipped):
 *
 *   D-A11Y-1 — the service/barber/date/slot options are `<button role="radio">`
 *     with NO keydown handler. Overriding a button's role to `radio` removes
 *     the native "Enter/Space fires click" behaviour, and the WAI-ARIA
 *     radiogroup keyboard pattern (arrow-roving + Space-selects) is not
 *     implemented — so a keyboard user CANNOT select a service/barber/date/
 *     time. Verified: the radio receives focus, but neither Enter nor Space
 *     activates it.
 *
 *   D-A11Y-2 — focus does NOT move to `#wizard-step-heading` on step advance.
 *     The heading is focusable directly (h2[tabindex=-1]) but the wizard's
 *     `setTimeout(80ms) -> heading.focus()` never lands it (focus stays on
 *     <body> after every advance, whether triggered by a radio click or the
 *     Continue button). The specced focus-management contract is inert in the
 *     prod build.
 *
 * The genuinely-operable keyboard path — the details form (real <input>s) —
 * IS covered by an active, passing test below.
 */
test.describe('booking — keyboard operability', () => {
  test.beforeEach(async ({ page }) => {
    const booking = new BookingPage(page);
    await page.goto('/book', { waitUntil: 'domcontentloaded' });
    await booking.clearPersistedDraft();
  });

  // D-A11Y-1 + D-A11Y-2 — FIXED. The radiogroups now implement the WAI-ARIA
  // roving-tabindex keyboard pattern (arrow-roving + Space/Enter select) and
  // focus moves to the step heading on every advance (the heading's own mount
  // effect lands it after the AnimatePresence transition).
  test('radiogroup is arrow/Enter operable and focus moves to the step heading @smoke', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto();

    const firstRadio = booking.serviceGroup().getByRole('radio').first();
    await firstRadio.focus();
    await expect(firstRadio).toBeFocused();

    // Arrow-roving moves focus within the group (the service/barber groups
    // commit on Space/Enter, not on every arrow press, because selecting
    // auto-advances the wizard). Focus must land on the second radio.
    await page.keyboard.press('ArrowDown');
    const secondRadio = booking.serviceGroup().getByRole('radio').nth(1);
    await expect(secondRadio).toBeFocused();

    // Space selects the focused radio and advances to the barber step.
    await page.keyboard.press('Space');
    await expect(booking.barberGroup()).toBeVisible();

    // Focus lands on the new step heading after the advance.
    await expect(booking.stepHeading()).toBeFocused();

    // The barber group is keyboard-operable too: focus the first radio, then
    // Enter selects it and advances to date/time.
    const firstBarber = booking.barberGroup().getByRole('radio').first();
    await firstBarber.focus();
    await page.keyboard.press('Enter');
    await expect(booking.dateGroup()).toBeVisible();
    await expect(booking.stepHeading()).toBeFocused();

    // The date group uses selection-follows-focus: arrow-roving selects a
    // date and reveals the time grid.
    const firstDate = booking.dateGroup().getByRole('radio').first();
    await firstDate.focus();
    await page.keyboard.press('Enter');
    await expect(booking.timeGroup()).toBeVisible();
  });

  test('the details form is fillable and submittable from the keyboard @smoke', async ({
    page,
  }) => {
    const booking = new BookingPage(page);
    await booking.goto();

    // Walk to the details step. Selection uses clicks (D-A11Y-1 means the
    // radiogroups are not keyboard-selectable yet); the focus of THIS test is
    // that the details form itself is keyboard-operable end to end.
    await booking.pickFirstService();
    await booking.pickFirstConcreteBarber();
    await booking.pickFirstDate();
    await booking.pickFirstAvailableSlot();
    await booking.continueButton().click();
    await expect(booking.detailsForm()).toBeVisible();

    // Fill the form by focusing each field and typing — no mouse fills.
    await booking.nameInput().focus();
    await page.keyboard.type('Tomasz Antczak');
    await booking.emailInput().focus();
    await page.keyboard.type('tomasz@example.com');
    await booking.phoneInput().focus();
    await page.keyboard.type('+48 600 100 200');

    // Submit from the keyboard — Enter in a text field submits the form (the
    // same RHF + Zod validation + server action the button runs).
    await booking.phoneInput().press('Enter');

    await expect(booking.confirmedHeading()).toBeVisible({ timeout: 15_000 });
  });
});
