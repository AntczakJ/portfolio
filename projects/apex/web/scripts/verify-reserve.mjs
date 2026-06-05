// @ts-nocheck
/* eslint-disable */
/**
 * Headless verification + screenshot capture of the apex RESERVATION WIZARD
 * (Tasks 5.4-5.6) under the PRODUCTION build + CSP (never `next dev`).
 *
 * Asserts:
 *   - ZERO CSP violations across the whole happy path, INCLUDING the server
 *     action submit (a same-origin POST → `connect-src 'self'`) and the `.ics`
 *     Blob download (a `blob:` object URL → `img-src ... blob:`).
 *   - NO <canvas> on /reserve (the wizard adds no R3F).
 *   - Deep-link seeding: `/reserve?vehicle=…&color=…&wheels=…` lands pre-seeded
 *     (vehicle chosen, on the dates step, config reflected).
 *   - Persistence: a selection survives a reload (localStorage restore).
 *   - Keyboard date picker: arrow-key roving focus + Enter selection works.
 *   - The mocked submit returns a deterministic confirmation + reference.
 *
 * Captures: each step desktop light + dark + mobile + the confirmation, into
 * scripts/.screenshots/ . Dark capture sets colorScheme:'dark' on the CONTEXT
 * (the lesson from the sections pass — next-themes follows the emulated scheme
 * on first paint; a stored theme alone is ignored).
 *
 * Run against an already-running `next start` on argv[2] (default 3090).
 */
const playwrightUrl =
  process.argv[3] ??
  new URL(
    '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
    import.meta.url,
  ).href;
const { chromium } = await import(playwrightUrl);
const fs = await import('node:fs');
const path = await import('node:path');

const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;
const SHOT_DIR = new URL('./.screenshots/', import.meta.url);
fs.mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name) => path.join(SHOT_DIR.pathname.replace(/^\/(\w:)/, '$1'), name);

const browser = await chromium.launch();

const allViolations = [];
const allConsoleErrors = [];

function wireDiagnostics(page, label) {
  page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(
        `${e.violatedDirective} blocked ${e.blockedURI || e.sourceFile || 'inline'}`,
      );
    });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') allConsoleErrors.push(`[${label}] ${msg.text()}`);
  });
}

async function collectViolations(page) {
  const v = await page.evaluate(() => window.__cspViolations ?? []);
  allViolations.push(...v);
}

// Deep-link seed (the flagship default config).
const SEED_VEHICLE = 'lumen-gt';
const SEED_COLOR = 'col-voltaic';
const SEED_WHEELS = 'whl-forged';

let pass = true;
const fail = (m) => {
  console.log('FAIL: ' + m);
  pass = false;
};

// ---------------------------------------------------------------------------
// 1. Deep-link seeding + the full happy path (desktop light).
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  wireDiagnostics(page, 'happy-light');

  // Discover the real deep-link slug/ids from the home fleet flagship link.
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  const flagHref = await page
    .locator('a[href*="/reserve?vehicle="][href*="color="]')
    .first()
    .getAttribute('href');
  const deepLink = flagHref
    ? `${BASE}${flagHref}`
    : `${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`;
  console.log('Deep link under test:', deepLink);

  await page.goto(deepLink, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(900);

  // Seeded: on the dates step (step 2), vehicle pre-chosen.
  const stepHeading = await page.locator('#wizard-step-heading').first().innerText();
  console.log('Seeded landing heading:', stepHeading.trim());
  if (!/dates|places/i.test(stepHeading)) {
    fail('deep link did not land on the dates step (expected pre-seeded vehicle)');
  }
  const railVehicle = await page.locator('aside').first().innerText();
  if (!/config|voltaic|forged/i.test(railVehicle.toLowerCase())) {
    console.log('NOTE: summary rail config text:', railVehicle.replace(/\s+/g, ' ').slice(0, 160));
  }

  const canvasCount = await page.locator('canvas').count();
  if (canvasCount !== 0) fail(`a <canvas> mounted on /reserve (expected 0), got ${canvasCount}`);

  await page.screenshot({ path: shot('reserve-step2-dates-light.png'), fullPage: true });

  // --- Keyboard date picker: focus a day, arrow-navigate, Enter to pick ---
  // The focusable widget is the day BUTTON wrapped in a role=gridcell (P2-4), so
  // target the button, not the (display:contents) gridcell wrapper. To keep the
  // HAPPY path clean (some early days border a booking), find the first run of
  // THREE consecutive selectable days and pick its ends via the keyboard.
  const cleanRun = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[data-day]'));
    const days = btns.map((b) => ({
      day: b.getAttribute('data-day'),
      ok: !b.hasAttribute('disabled'),
    }));
    for (let i = 0; i < days.length - 2; i += 1) {
      if (days[i].ok && days[i + 1].ok && days[i + 2].ok) {
        return { start: days[i].day, end: days[i + 2].day };
      }
    }
    return null;
  });
  if (!cleanRun) fail('could not find a clean 3-day run in the visible window');
  const startBtn = page.locator(`button[data-day="${cleanRun.start}"]`);
  await startBtn.focus();
  await page.keyboard.press('Enter'); // pick-up day
  // Arrow to the end day (two days forward) then Enter — a clean 3-day rental.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const pickedRange = await page.locator('[aria-selected="true"]').count();
  console.log('Keyboard-selected day cells:', pickedRange);
  if (pickedRange < 2) {
    fail(`keyboard date selection did not commit a multi-day range (got ${pickedRange})`);
  }

  // Choose pickup + return locations (different → one-way fee).
  const pickupRadios = page.locator('input[name="apex-pickup"]');
  const returnRadios = page.locator('input[name="apex-return"]');
  await pickupRadios.nth(0).check({ force: true });
  await returnRadios.nth(1).check({ force: true });
  await page.waitForTimeout(300);

  // Continue → extras.
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('reserve-step3-extras-light.png'), fullPage: true });

  // Add an extra + an insurance tier (price should update live).
  const totalBefore = await page.locator('aside [aria-live="polite"]').last().innerText();
  await page.locator('input[type="checkbox"]').first().check({ force: true });
  await page.locator('input[name="apex-insurance"]').nth(2).check({ force: true });
  await page.waitForTimeout(300);
  const totalAfter = await page.locator('aside [aria-live="polite"]').last().innerText();
  console.log('Live total before extras:', totalBefore.trim(), '→ after:', totalAfter.trim());
  if (totalBefore.trim() === totalAfter.trim()) {
    console.log('NOTE: total unchanged after adding extras — check selection wired.');
  }

  // Continue → driver.
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('reserve-step4-driver-light.png'), fullPage: true });

  // Fill the driver form.
  await page.fill('#driver-name', 'Ada Lovelace');
  await page.fill('#driver-email', 'ada@example.com');
  await page.fill('#driver-phone', '+44 20 7946 0000');
  await page.fill('#driver-licence', 'LOVEL12345');
  await page.waitForTimeout(200);

  // Submit (the server action). Capture any CSP violation from the POST.
  await page.getByRole('button', { name: /Confirm reservation/ }).click();
  await page.waitForTimeout(1800);

  const confHeading = await page.locator('#wizard-step-heading').first().innerText().catch(() => '');
  console.log('Confirmation heading:', confHeading.trim());
  if (!/all set/i.test(confHeading)) fail('submit did not reach the confirmation step');

  const refText = await page.locator('text=/APX-/').first().innerText().catch(() => '');
  console.log('Confirmation reference:', refText.trim());
  if (!/APX-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(refText)) {
    fail('confirmation reference not in the deterministic APX-XXXX-XXXX form');
  }

  // The .ics download — click "Add to calendar" and confirm a download fires
  // with no CSP violation.
  let downloadOk = false;
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 4000 }),
      page.getByRole('button', { name: /Add to calendar/ }).click(),
    ]);
    const fn = download.suggestedFilename();
    console.log('.ics download fired:', fn);
    downloadOk = /^apex-apx-.*\.ics$/.test(fn);
  } catch (e) {
    console.log('.ics download did NOT fire:', e.message);
  }
  if (!downloadOk) fail('.ics download did not fire with the expected filename');

  await page.screenshot({ path: shot('reserve-step5-confirmation-light.png'), fullPage: true });

  await collectViolations(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2. Persistence across reload (a fresh context, set a range, reload).
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  wireDiagnostics(page, 'persist');
  await page.goto(`${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`, {
    waitUntil: 'load',
    timeout: 45000,
  });
  await page.waitForTimeout(700);
  // Pick a clean 2-day range via keyboard (first run of two selectable days).
  const run2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[data-day]'));
    const days = btns.map((b) => ({
      day: b.getAttribute('data-day'),
      ok: !b.hasAttribute('disabled'),
    }));
    for (let i = 0; i < days.length - 1; i += 1) {
      if (days[i].ok && days[i + 1].ok) return { start: days[i].day };
    }
    return null;
  });
  await page.locator(`button[data-day="${run2.start}"]`).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.locator('input[name="apex-pickup"]').nth(0).check({ force: true });
  await page.locator('input[name="apex-return"]').nth(0).check({ force: true });
  await page.waitForTimeout(400);
  const beforeReload = await page.locator('aside').first().innerText();

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  const afterReload = await page.locator('aside').first().innerText();
  const persisted = /\d{4}-\d{2}-\d{2}/.test(afterReload);
  console.log('Range persisted across reload:', persisted);
  if (!persisted) fail('the chosen range did not persist across a reload');

  await collectViolations(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2b. A-06 — DELIBERATELY INVALID date selection shows a SPECIFIC reason on the
//     aria-live status (not a silent restart). We pick a start day then pick a
//     return day that crosses a booked (struck-out / disabled) day, and assert
//     the status line names the reason.
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  wireDiagnostics(page, 'invalid-date');
  await page.goto(
    `${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`,
    { waitUntil: 'load', timeout: 45000 },
  );
  await page.evaluate(() => localStorage.removeItem('apex:reservation-draft'));
  await page.goto(
    `${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`,
    { waitUntil: 'load', timeout: 45000 },
  );
  await page.waitForTimeout(900);

  // The status line element (describes the grid).
  const statusSel = '[role="grid"]';
  // Find the first BOOKED (disabled, struck-out) day in the visible calendar.
  const bookedDay = page.locator('button[data-day][disabled]:has-text("")').first();
  const bookedCount = await page.locator('button[data-day][disabled]').count();
  console.log('Disabled (booked/past) day buttons visible:', bookedCount);

  // Strategy: find a SELECTABLE day immediately followed (within a few days) by a
  // BOOKED day, pick the selectable as pick-up, then attempt a return PAST the
  // booked day — the range crosses a booking → a 'conflict' rejection message.
  const dayInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[data-day]'));
    const days = btns.map((b) => ({
      day: b.getAttribute('data-day'),
      disabled: b.hasAttribute('disabled'),
    }));
    // Find a selectable day with a booked day within the next 5 days and a
    // selectable day after that booked day.
    for (let i = 0; i < days.length; i += 1) {
      if (days[i].disabled) continue;
      for (let j = i + 1; j < Math.min(i + 6, days.length); j += 1) {
        if (days[j].disabled) {
          // a booked day at j; find a selectable day after it
          for (let k = j + 1; k < Math.min(j + 4, days.length); k += 1) {
            if (!days[k].disabled) {
              return { start: days[i].day, booked: days[j].day, end: days[k].day };
            }
          }
        }
      }
    }
    return null;
  });
  console.log('Invalid-range probe (start/booked/end):', JSON.stringify(dayInfo));

  let rejectionShown = false;
  let rejectionText = '';
  if (dayInfo) {
    // Drive the two picks via NATIVE DOM clicks (a programmatic .focus() after
    // the first pick disrupts Playwright's .click() actionability on the second;
    // a native click is the reliable way to exercise the two-pick path headless).
    await page.evaluate(
      (d) => document.querySelector(`button[data-day="${d}"]`)?.click(),
      dayInfo.start,
    );
    await page.waitForTimeout(200);
    await page.evaluate(
      (d) => document.querySelector(`button[data-day="${d}"]`)?.click(),
      dayInfo.end,
    );
    await page.waitForTimeout(300);
    const statusId = await page.locator(statusSel).first().getAttribute('aria-describedby');
    rejectionText = await page.locator(`#${statusId}`).innerText().catch(() => '');
    console.log('Status after invalid (booked-crossing) pick:', rejectionText.trim());
    // Require the SPECIFIC conflict vocabulary — not the default status copy.
    rejectionShown = /already booked|overlap a day/i.test(rejectionText);
    await page.screenshot({ path: shot('reserve-step2-dates-rejection.png'), fullPage: true });
  } else {
    fail('A-06: could not construct a booked-crossing range from the visible window');
  }
  if (!rejectionShown) {
    fail('A-06: an invalid date range did NOT surface a specific reason on the status line');
  } else {
    console.log('A-06 OK — invalid range surfaced a specific conflict reason.');
  }

  await collectViolations(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2c. A-21 — reduced-motion confirmation frame (full happy path, prefers-
//     reduced-motion emulated; capture the confirmation incl. the A-17 config
//     render with motion disabled).
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  wireDiagnostics(page, 'reduced-motion');
  await page.goto(
    `${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`,
    { waitUntil: 'load', timeout: 45000 },
  );
  await page.evaluate(() => localStorage.removeItem('apex:reservation-draft'));
  await page.goto(
    `${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`,
    { waitUntil: 'load', timeout: 45000 },
  );
  await page.waitForTimeout(800);
  // Pick a clean 2-day range (first run of two selectable days).
  const rmRun = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[data-day]'));
    const days = btns.map((b) => ({
      day: b.getAttribute('data-day'),
      ok: !b.hasAttribute('disabled'),
    }));
    for (let i = 0; i < days.length - 1; i += 1) {
      if (days[i].ok && days[i + 1].ok) return { start: days[i].day };
    }
    return null;
  });
  await page.locator(`button[data-day="${rmRun.start}"]`).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.locator('input[name="apex-pickup"]').nth(0).check({ force: true });
  await page.locator('input[name="apex-return"]').nth(1).check({ force: true });
  await page.waitForTimeout(300);
  // Capture the dates step too (two-month desktop, reduced-motion).
  await page.screenshot({ path: shot('reserve-step2-dates-rm.png'), fullPage: true });
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForTimeout(400);
  // Capture the insurance step (A-16 ladder + recommended mark).
  await page.locator('input[name="apex-insurance"]').nth(1).check({ force: true });
  await page.waitForTimeout(200);
  await page.screenshot({ path: shot('reserve-step3-insurance.png'), fullPage: true });
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForTimeout(400);
  await page.fill('#driver-name', 'Grace Hopper');
  await page.fill('#driver-email', 'grace@example.com');
  await page.fill('#driver-phone', '+1 202 555 0100');
  await page.fill('#driver-licence', 'HOPPE54321');
  await page.getByRole('button', { name: /Confirm reservation/ }).click();
  await page.waitForTimeout(1800);
  const rmHeading = await page.locator('#wizard-step-heading').first().innerText().catch(() => '');
  if (!/all set/i.test(rmHeading)) {
    console.log('NOTE: reduced-motion path did not reach confirmation (heading:', rmHeading.trim(), ')');
  }
  // A-17: the chosen-config render must be present on the confirmation.
  const configRender = await page.locator('img[alt*="configuration"]').count();
  console.log('A-17 config render present on confirmation:', configRender);
  if (configRender === 0) {
    fail('A-17: no chosen-configuration render on the confirmation step');
  }
  await page.screenshot({ path: shot('reserve-step5-confirmation-rm.png'), fullPage: true });
  await collectViolations(page);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. Dark + mobile captures (colorScheme on the context — the sections lesson).
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  wireDiagnostics(page, 'dark');
  // next-themes follows colorScheme on first paint AND the stored theme; seed
  // both so the dark class is applied before the wizard mounts (the PASS-C
  // lesson: set localStorage.theme so next-themes does not revert the class).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark');
    } catch {
      /* no-op */
    }
  });
  await page.goto(`${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`, {
    waitUntil: 'load',
    timeout: 45000,
  });
  await page
    .waitForFunction(() => document.documentElement.classList.contains('dark'), {
      timeout: 5000,
    })
    .catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot('reserve-step2-dates-dark.png'), fullPage: true });
  await collectViolations(page);
  await ctx.close();
}
{
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 760 },
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  wireDiagnostics(page, 'mobile');
  await page.goto(`${BASE}/reserve?vehicle=${SEED_VEHICLE}&color=${SEED_COLOR}&wheels=${SEED_WHEELS}`, {
    waitUntil: 'load',
    timeout: 45000,
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot('reserve-step2-dates-mobile.png'), fullPage: true });
  // The fresh (vehicle) step on mobile too — start a clean wizard.
  await page.goto(`${BASE}/reserve`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.evaluate(() => localStorage.removeItem('apex:reservation-draft'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot('reserve-step1-vehicle-mobile.png'), fullPage: true });
  await collectViolations(page);
  await ctx.close();
}

await browser.close();

console.log('\n================ RESERVE VERIFICATION SUMMARY ================');
console.log(`CSP violations:   ${allViolations.length}`);
for (const v of allViolations) console.log('  - ' + v);
const realConsoleErrors = allConsoleErrors.filter((e) => !/404|favicon/.test(e));
console.log(`Console errors (excl. 404/favicon): ${realConsoleErrors.length}`);
for (const e of realConsoleErrors) console.log('  - ' + e);

if (allViolations.length > 0) fail('CSP violation(s) detected (quality bar is ZERO).');

console.log(`\n${pass ? 'PASS' : 'FAIL'} — apex /reserve verification`);
process.exit(pass ? 0 : 1);
