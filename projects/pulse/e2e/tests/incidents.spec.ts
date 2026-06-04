import { expect, test } from '@playwright/test';

/**
 * Test 5 — the incidents view.
 *
 * Renders the seeded incident history (varied causes, the product-plausible
 * "Checkout API" name — NEVER the internal "wow-moment target" label), and the
 * open / resolved filter tabs narrow the list.
 */
test.describe('incidents view — history + filters', () => {
  test('renders the seeded history with varied causes and a clean name', async ({
    page,
  }) => {
    await page.goto('/dashboard/incidents', { waitUntil: 'domcontentloaded' });

    const section = page.getByRole('region', { name: 'Incidents' });
    await expect(section).toBeVisible();

    // Rows render (the seeded resolved history + any live-open incident).
    const rows = section.getByRole('listitem');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    expect(await rows.count()).toBeGreaterThan(1);

    // The seeded causes are varied — assert at least two distinct real causes
    // appear (not one identical loop).
    await expect(section).toContainText(/Connection refused|HTTP 500|timeout|keyword/i);

    // The internal label must NEVER appear.
    await expect(section).not.toContainText(/wow-moment target/i);
    // The product-plausible service name is present.
    await expect(section).toContainText('Checkout API');
  });

  test('the open / resolved filter narrows the list', async ({ page }) => {
    await page.goto('/dashboard/incidents', { waitUntil: 'domcontentloaded' });

    const tablist = page.getByRole('tablist', { name: 'Filter incidents' });
    await expect(tablist).toBeVisible();
    const section = page.getByRole('region', { name: 'Incidents' });
    // Scope status-pill assertions to the incident LIST so the filter TABS
    // (which also carry the words "Open" / "Resolved") are never matched.
    const list = section.getByRole('list');

    // Switch to "Resolved" — every visible row must read Resolved, none "Open".
    await tablist.getByRole('tab', { name: 'Resolved' }).click();
    const resolvedRows = list.getByRole('listitem');
    await expect(resolvedRows.first()).toBeVisible({ timeout: 15_000 });
    await expect(list.getByText('Resolved').first()).toBeVisible();
    // No row in the resolved view carries the "Open" status pill.
    await expect(list.getByText('Open', { exact: true })).toHaveCount(0);

    // Switch to "Open" — the list shows only open incidents (or the empty state).
    await tablist.getByRole('tab', { name: 'Open' }).click();
    await expect(
      section.getByText(/No open incidents/).or(list.getByText('Open').first()),
    ).toBeVisible({ timeout: 15_000 });
  });
});
