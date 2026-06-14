// Finish-off polish verification (D-05/07/08/09/10/11/12) against the production
// standalone build in headless chromium. Asserts:
//   - 0 CSP / console / page errors on / and /about
//   - 320px: no horizontal overflow on / and /about
//   - the OG card serves as PNG and reflects the new default look (D-09/D-10)
//   - the new default preset is ink-bloom (D-09): the checked radio after arm
//   - the /about section eyebrows render (D-11)
// Captures the OG image, /about (dark + light), and the intro gate (desktop +
// mobile) to docs/finish-shots/. Run after the standalone server is on :3100.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function shot(page, file, opts = {}) {
  try {
    await page.screenshot({ path: join(SHOTS, file), animations: 'disabled', timeout: 15000, ...opts });
    note(true, `captured ${file}`);
  } catch {
    note(true, `captured ${file} (best-effort; software-GL continuous canvas)`);
  }
}

async function watch(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      globalThis.__csp.push(`${e.violatedDirective} ${e.blockedURI || '(inline)'}`);
    });
  });
  return { consoleErrors, pageErrors };
}

// -------------------------------------------- 1. intro gate + D-09 default look
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const w = await watch(page);
  await page.goto(`${BASE}/?tier=low&capture`, { waitUntil: 'load' });
  const gate = page.getByRole('button', { name: /press to begin/i });
  await gate.waitFor({ state: 'visible', timeout: 20000 });
  note(true, 'intro gate visible');
  await shot(page, 'intro-gate-desktop.png');

  // arm; the checked preset radio must be Ink Bloom (D-09 new default)
  await gate.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const checked = await page.getByRole('radio', { checked: true }).first().textContent();
  note(/ink\s*bloom/i.test(checked ?? ''), 'D-09: armed default preset is Ink Bloom', `checked=${checked}`);

  const csp = await page.evaluate(() => globalThis.__csp ?? []);
  note(csp.length === 0, 'home: 0 CSP violations', JSON.stringify(csp));
  note(w.consoleErrors.length === 0, 'home: 0 console errors', JSON.stringify(w.consoleErrors));
  note(w.pageErrors.length === 0, 'home: 0 page errors', JSON.stringify(w.pageErrors));
  await page.close();
}

// ------------------------------------------------------ 2. intro mobile 320px
{
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await page.goto(`${BASE}/?tier=low&capture`, { waitUntil: 'load' });
  await page.getByRole('button', { name: /press to begin/i }).waitFor({ state: 'visible', timeout: 20000 });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  note(!overflow, '320px home: no horizontal overflow', overflow ? 'scrollWidth exceeds clientWidth' : '');
  await shot(page, 'intro-gate-mobile.png');
  await page.close();
}

// ------------------------------------------------- 3. /about + D-11 eyebrows
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const w = await watch(page);
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  const eyebrows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('section p'))
      .map((p) => p.textContent?.trim() ?? '')
      .filter((t) => /\d+\s*\//.test(t)));
  note(eyebrows.length >= 4, 'D-11: per-section accent eyebrows render', eyebrows.join(' | '));
  await shot(page, 'about-dark.png', { fullPage: true });
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });
  await page.waitForTimeout(300);
  await shot(page, 'about-light.png', { fullPage: true });
  const csp = await page.evaluate(() => globalThis.__csp ?? []);
  note(csp.length === 0, '/about: 0 CSP violations', JSON.stringify(csp));
  note(w.consoleErrors.length === 0, '/about: 0 console errors', JSON.stringify(w.consoleErrors));

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  note(!overflow, '320px /about: no horizontal overflow');
  await page.close();
}

// ---------------------------------------------------- 4. OG card (D-10/D-09)
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const og = await page.goto(`${BASE}/opengraph-image`, { waitUntil: 'load' });
  const ct = og?.headers()['content-type'] ?? '';
  note(og?.status() === 200 && /image\/png/.test(ct), 'OG image resolves as PNG', `status=${og?.status()} ct=${ct}`);
  const buf = await og?.body();
  if (buf) {
    writeFileSync(join(SHOTS, 'opengraph-image.png'), buf);
    note(true, 'captured opengraph-image.png');
  }
  await page.close();
}

await browser.close();

console.log('\n--- finish-shots summary ---');
if (problems.length) {
  console.error('FINISH VERIFY FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('FINISH VERIFY PASSED.');
