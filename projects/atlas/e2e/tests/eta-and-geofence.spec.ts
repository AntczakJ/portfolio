import { expect, test, type Page } from '@playwright/test';

/**
 * A focused vehicle's ETA decrements over time, and a geofence event fires and
 * lands on the events feed (Task 8.2).
 *
 * DETERMINISM (the hard rule): the geofence beat is driven by the deterministic
 * demo affordance ("Play geofence beat" — it focuses an en-route vehicle that is
 * approaching a zone and bumps the demo speed via `sim.control` so the crossing
 * fires within seconds), and the assertions wait on REAL STATE (the ETA value
 * dropping, an event row appearing in the feed) via web-first polling — NEVER an
 * arbitrary sleep against the engine's organic schedule.
 */

test('a focused vehicle ETA decrements over time', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Bump the demo speed so the ETA moves visibly within the test window (this is
  // the deterministic engine being driven, not a wait — the world advances
  // faster but the math is identical).
  await page.getByRole('button', { name: /Play geofence beat/i }).click();

  // The detail panel pins the focused vehicle with a live "ETA next stop" metric.
  const etaValue = page.locator('dd', { hasText: /^(\d+:\d{2}|\d+s|--)$/ }).first();
  await expect(etaValue).toBeVisible({ timeout: 20_000 });

  // Capture a baseline ETA (must be a real time, not the no-ETA placeholder),
  // then assert it decrements as the vehicle progresses toward its next stop.
  const firstEta = await readEtaSeconds(page);
  expect(firstEta).not.toBeNull();

  await expect
    .poll(async () => readEtaSeconds(page), {
      timeout: 30_000,
      message: 'the focused vehicle ETA should decrement as it advances',
    })
    .toBeLessThan(firstEta ?? Number.POSITIVE_INFINITY);
});

test('a geofence event fires and lands on the events feed (driven by the demo beat)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });

  // The events feed starts empty (or with whatever has organically fired); we
  // drive the deterministic beat and assert a NEW geofence row lands.
  const feed = page.getByRole('heading', { name: 'Events' }).locator('..').locator('..');
  await expect(feed).toBeVisible();

  // Drive the deterministic demo affordance: focus an approaching vehicle + bump
  // the speed so a crossing fires soon. (Idempotent — clicking again re-curates.)
  await page.getByRole('button', { name: /Play geofence beat/i }).click();

  // A geofence event row materialises in the feed. The copy reads e.g.
  // "Unit 7 entered Downtown" / "Unit 7 left Downtown" — assert an enter/exit
  // line appears (the world reacting, driven by the real engine).
  const geofenceRow = page.getByText(/Unit \d+ (entered|left) /i).first();
  await expect(geofenceRow).toBeVisible({ timeout: 45_000 });
});

/**
 * Read the focused vehicle's ETA from the detail panel "ETA next stop" metric,
 * normalised to seconds. Returns null when there is no meaningful ETA (the `--`
 * placeholder). Formats: `m:ss` (e.g. `1:26`), `Ns` (e.g. `42s`), or `--`.
 */
async function readEtaSeconds(page: Page): Promise<number | null> {
  // The detail panel ETA metric: a <dd> with aria-live following the "ETA next
  // stop" <dt>. Read the first such instrument value on the page.
  const dd = page.locator('dd.text-accent-ink').first();
  if ((await dd.count()) === 0) return null;
  const raw = (await dd.innerText()).trim();
  if (raw === '--' || raw === '') return null;
  const colon = /^(\d+):(\d{2})$/.exec(raw);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const secs = /^(\d+)s$/.exec(raw);
  if (secs) return Number(secs[1]);
  const bare = Number(raw.replace(/[^\d]/g, ''));
  return Number.isFinite(bare) ? bare : null;
}
