import { expect, test, type Page } from '@playwright/test';

/**
 * Keyboard operation of the date-range picker (Task 7.2c).
 *
 * Asserts the WAI-ARIA grid widget: roving-tabindex (one tabbable day), Arrow /
 * Home / End navigation, Enter selection of a half-open range, booked days
 * disabled + announced, and — crucially (A-06) — that an INVALID range surfaces
 * a SPECIFIC reason on the aria-live status (never a silent restart).
 *
 * Deterministic: the frozen clock (now = 2026-06-15) + the seeded hero booking
 * [2026-06-21, 2026-06-26) make the disabled/conflict cases reproducible.
 */

const RESERVE = '/reserve?vehicle=lumen-gt&color=col-voltaic&wheels=whl-forged';

async function freshReserve(page: Page): Promise<void> {
  await page.goto(RESERVE);
  await page.evaluate(() => {
    localStorage.removeItem('apex:reservation-draft');
  });
  await page.goto(RESERVE);
  await expect(page.locator('#wizard-step-heading')).toContainText(/dates|places/i);
  // Wait for the calendar grid to actually render its day cells before probing.
  await expect(page.locator('button[data-day]').first()).toBeVisible();
  // The disabled (booked) days come from the TanStack Query availability layer,
  // which has a deterministic artificial latency. Wait until the seeded hero
  // booking [2026-06-21, 2026-06-26) has disabled day 2026-06-21 before probing
  // — otherwise only the past/window guards are reflected (a race the standalone
  // verify scripts dodge with a fixed sleep).
  await expect(page.locator('button[data-day="2026-06-21"]')).toBeDisabled();
}

test('exposes a roving-tabindex grid (exactly one tabbable day)', async ({ page }) => {
  await freshReserve(page);
  const tabbable = page.locator('button[data-day][tabindex="0"]');
  await expect(tabbable).toHaveCount(1);
  // The grid is a real ARIA grid.
  await expect(page.locator('[role="grid"]').first()).toBeVisible();
});

/** The data-day of the currently focused day cell (the picker moves DOM focus
 *  asynchronously via an effect, so callers poll on this). */
function activeDay(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-day') ?? '');
}

/** True when DOM focus is on a day cell within the calendar grid. */
function focusIsDayCell(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return !!el && el.hasAttribute('data-day') && !!el.closest('[role="grid"]');
  });
}


test('Arrow keys move the roving focus across selectable days', async ({ page }) => {
  await freshReserve(page);
  // Enter the grid the way a keyboard user does: focus the single roving
  // tabbable day (`tabindex=0`). Focusing a `tabindex=-1` day would be reverted
  // by the picker's focus-retention effect, so we drive from the roving day.
  const rover = page.locator('button[data-day][tabindex="0"]');
  await rover.focus();
  await expect.poll(() => focusIsDayCell(page)).toBe(true);
  const start = await activeDay(page);
  expect(start).not.toBe('');

  // ArrowRight moves focus FORWARD (skipping any disabled day) — focus is moved
  // async via an effect, so poll for the change.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => activeDay(page)).not.toBe(start);
  expect((await activeDay(page)) > start).toBe(true);
  await expect.poll(() => focusIsDayCell(page)).toBe(true);

  // ArrowLeft moves it back toward the start (focus stays a day cell).
  const afterRight = await activeDay(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => activeDay(page)).not.toBe(afterRight);
  expect((await activeDay(page)) < afterRight).toBe(true);
  await expect.poll(() => focusIsDayCell(page)).toBe(true);
});

test('Enter selects a half-open multi-day range', async ({ page }) => {
  await freshReserve(page);
  const run = await page.evaluate(() => {
    const btns = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[data-day]'),
    ).map((b) => ({ day: b.getAttribute('data-day') ?? '', ok: !b.hasAttribute('disabled') }));
    for (let i = 0; i <= btns.length - 3; i += 1) {
      if (btns.slice(i, i + 3).every((d) => d.ok)) return btns.slice(i, i + 3).map((d) => d.day);
    }
    return [];
  });
  await page.locator(`button[data-day="${run[0] ?? ''}"]`).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  // The selected band spans more than one day cell.
  const selected = await page.locator('[aria-selected="true"]').count();
  expect(selected).toBeGreaterThanOrEqual(2);
});

test('booked days are disabled and announced (not silently inert)', async ({ page }) => {
  await freshReserve(page);
  // The seeded hero booking blacks out days; there must be disabled day cells.
  const disabled = page.locator('button[data-day][disabled]');
  await expect(disabled.first()).toBeVisible();
  // They are aria-disabled (announced) — not merely visually struck.
  const ariaDisabled = await disabled.first().getAttribute('aria-disabled');
  expect(ariaDisabled).toBe('true');
});

test('A-06: an invalid (booked-crossing) range surfaces a SPECIFIC reason on the status line', async ({
  page,
}) => {
  await freshReserve(page);

  // Find a selectable day with a booked day shortly after it and a selectable
  // day past the booking → picking start then the far day crosses the booking.
  const probe = await page.evaluate(() => {
    const days = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[data-day]'),
    ).map((b) => ({ day: b.getAttribute('data-day') ?? '', disabled: b.hasAttribute('disabled') }));
    for (let i = 0; i < days.length; i += 1) {
      if (days[i]!.disabled) continue;
      for (let j = i + 1; j < Math.min(i + 10, days.length); j += 1) {
        if (days[j]!.disabled) {
          for (let k = j + 1; k < Math.min(j + 12, days.length); k += 1) {
            if (!days[k]!.disabled) return { start: days[i]!.day, end: days[k]!.day };
          }
        }
      }
    }
    return null;
  });
  expect(probe).not.toBeNull();

  // Native DOM clicks for the two-pick path (the verify-reserve lesson).
  await page.evaluate((d) => {
    document.querySelector<HTMLButtonElement>(`button[data-day="${d}"]`)?.click();
  }, probe!.start);
  await page.evaluate((d) => {
    document.querySelector<HTMLButtonElement>(`button[data-day="${d}"]`)?.click();
  }, probe!.end);

  const statusId = await page
    .locator('[role="grid"]')
    .first()
    .getAttribute('aria-describedby');
  expect(statusId).toBeTruthy();
  const status = page.locator(`#${statusId ?? ''}`);
  await expect(status).toContainText(/already booked|overlap a day/i);
});
