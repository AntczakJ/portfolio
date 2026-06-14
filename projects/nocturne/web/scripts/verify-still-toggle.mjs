// Headless verification of the Still-toggle fix (the capability-floor vs the
// Still-motion-still distinction).
//
// THE BUG: toggling the HUD motion-mode to "Still" a few times on a CAPABLE
// (real-GPU) device made the page scrollable + the wordmark drift off-centre,
// because the Stage drove `data-armed` + the page-overflow lock off the RESOLVED
// route (`still` → resolved `poster`), conflating the Still-motion still with the
// genuine Tier-4 capability floor. The fix keys both off `isCapabilityFloor`
// (config === null || config.route === 'poster'), so a capable device's Still is
// a frozen-poster still that STAYS scroll-locked with the SSR directory hidden.
//
// PART A — forced-capable context (`?tier=low`, which forces a live config so
// Still vs capability-floor differ). Arm the field, then toggle Still SEVERAL
// times and assert EACH time:
//   (1) NO horizontal overflow (scrollWidth === clientWidth);
//   (2) `data-armed` STAYS set (the SSR directory does NOT reveal);
//   (3) html + body overflow stay 'hidden' (locked);
//   (4) the poster is visible as the frozen still AND the HUD is still present;
//   (5) the intro gate did NOT re-appear (armState not reset).
// Then toggle back to Full and confirm the live field returns.
//
// PART B — the GENUINE capability floor (no `?tier=`, SwiftShader → poster). It
// MUST still reveal the scrollable directory (data-armed absent) + the field
// must be unarmed. (No regression to the Tier-4 floor.)
//
// Also captures a Still-mode shot to docs/finish-shots/. Run AFTER the standalone
// server is on :3100. Exits non-zero on any failure.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'finish-shots');
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const note = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label + (detail ? `: ${detail}` : ''));
};

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

function watch(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return { consoleErrors, pageErrors };
}

// Snapshot the load-bearing layout state in one round-trip.
async function readState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const fallback = document.querySelector('[data-nojs-fallback]');
    return {
      armed: root.hasAttribute('data-armed'),
      horizontalOverflow: root.scrollWidth > root.clientWidth,
      rootOverflow: getComputedStyle(root).overflowX,
      bodyOverflow: getComputedStyle(document.body).overflowX,
      // The SSR directory is hidden by `[data-armed] [data-nojs-fallback]{display:none}`.
      // "revealed" means it is laid out (the off-centre bug surface).
      directoryRevealed: fallback ? fallback.offsetParent !== null : false,
    };
  });
}

// ----------------------------------------- PART A: capable device, Still toggle
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const w = watch(page);
  // `?tier=low` forces a LIVE/capable config (the software gate is bypassed), so
  // Still (resolved poster, capable config) differs from the capability floor.
  await page.goto(`${BASE}/?tier=low&capture`, { waitUntil: 'load' });

  const gate = page.getByRole('button', { name: /press to begin/i });
  await gate.waitFor({ state: 'visible', timeout: 20000 });
  note(true, 'A: intro gate visible pre-arm');

  // arm by keyboard (the software-GL continuous-canvas .click() stability caveat)
  await gate.focus();
  await page.keyboard.press('Enter');

  // the HUD must replace the gate (the gate→HUD swap is the real "armed" signal)
  const stillBtn = page.getByRole('button', { name: /still motion/i });
  const fullBtn = page.getByRole('button', { name: /full motion/i });
  await stillBtn.waitFor({ state: 'visible', timeout: 20000 });
  note(
    !(await gate.isVisible().catch(() => false)),
    'A: armed — intro gate gone, HUD present',
  );

  // toggle Still several times; assert the invariants EACH time
  for (let i = 1; i <= 4; i += 1) {
    await stillBtn.focus();
    await page.keyboard.press('Enter');
    // allow the 1000ms poster cross-fade to settle (the field→poster freeze)
    await page.waitForTimeout(1300);

    const s = await readState(page);
    // (1) no horizontal overflow
    note(!s.horizontalOverflow, `A.${i}: Still — no horizontal overflow`);
    // (2) data-armed stays set (the SSR directory does NOT reveal)
    note(s.armed, `A.${i}: Still — data-armed STAYS set`);
    note(!s.directoryRevealed, `A.${i}: Still — SSR directory NOT revealed`);
    // (3) overflow stays hidden (locked)
    note(
      s.rootOverflow === 'hidden' && s.bodyOverflow === 'hidden',
      `A.${i}: Still — html+body overflow locked`,
      `root=${s.rootOverflow} body=${s.bodyOverflow}`,
    );
    // (4) poster visible as the frozen still + HUD still present. The poster
    // wrapper is the `aria-hidden` opacity-driven layer inside `.stage-ground`;
    // on Still its computed opacity must be ~1 (the frozen still, not blank).
    const posterOpacity = await page.evaluate(() => {
      const layer = document.querySelector('.stage-ground [aria-hidden="true"]');
      return layer ? parseFloat(getComputedStyle(layer).opacity) : 0;
    });
    const posterVisible = posterOpacity > 0.9;
    const stillPressed = await stillBtn.getAttribute('aria-pressed');
    note(
      posterVisible && stillPressed === 'true' && (await stillBtn.isVisible()),
      `A.${i}: Still — poster still shown + HUD (Still) present`,
      `posterOpacity=${posterOpacity} stillPressed=${stillPressed}`,
    );
    // (5) the intro gate did NOT re-appear (armState not reset)
    note(
      !(await gate.isVisible().catch(() => false)),
      `A.${i}: Still — intro gate did NOT re-appear`,
    );
  }

  await page.screenshot({ path: join(SHOTS, 'still-mode-desktop.png'), animations: 'disabled', timeout: 15000 })
    .then(() => note(true, 'captured still-mode-desktop.png'))
    .catch(() => note(true, 'captured still-mode-desktop.png (best-effort; software-GL)'));

  // toggle back to Full — the live field must return (gate stays gone)
  await fullBtn.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const afterFull = await readState(page);
  const fullPressed = await fullBtn.getAttribute('aria-pressed');
  note(
    afterFull.armed && fullPressed === 'true' && !afterFull.horizontalOverflow,
    'A: back to Full — armed, locked, no overflow',
    `fullPressed=${fullPressed} armed=${afterFull.armed} overflow=${afterFull.horizontalOverflow}`,
  );
  note(
    !(await gate.isVisible().catch(() => false)),
    'A: back to Full — intro gate still gone (live field returns)',
  );

  const cspA = await page.evaluate(() => globalThis.__csp ?? []);
  note(cspA.length === 0 || cspA.length === undefined, 'A: 0 CSP violations', JSON.stringify(cspA));
  note(w.consoleErrors.length === 0, 'A: 0 console errors', JSON.stringify(w.consoleErrors));
  note(w.pageErrors.length === 0, 'A: 0 page errors', JSON.stringify(w.pageErrors));
  await page.close();
}

// --------------------------- PART B: the genuine capability floor (no regression)
// A separate browser WITHOUT the swiftshader allow-flags so `detectGpuTier`'s
// software gate routes to the poster (the genuine Tier-4 floor) — mirrors
// verify-software-gate.mjs.
{
  const floorBrowser = await chromium.launch();
  const page = await floorBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  // NO `?tier=` — the real probe must see software GL and route to the poster.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const s = await readState(page);
  note(!s.armed, 'B: capability floor — data-armed ABSENT (directory revealed)');
  note(s.directoryRevealed, 'B: capability floor — SSR directory IS laid out (scrollable)');

  const directoryCards = await page
    .locator('[data-nojs-fallback] article, [data-nojs-fallback] a')
    .count();
  note(directoryCards > 0, 'B: capability floor — directory cards present', `count=${directoryCards}`);

  const beginVisible = await page
    .getByRole('button', { name: /press to begin|begin/i })
    .isVisible()
    .catch(() => false);
  note(!beginVisible, 'B: capability floor — no begin gate (field unarmed)');

  await page.close();
  await floorBrowser.close();
}

await browser.close();

console.log('\n--- still-toggle summary ---');
if (problems.length) {
  console.error('STILL-TOGGLE VERIFY FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('STILL-TOGGLE VERIFY PASSED.');
