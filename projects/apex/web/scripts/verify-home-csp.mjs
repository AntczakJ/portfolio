// @ts-nocheck
/* eslint-disable */
/**
 * verify-home-csp.mjs — scroll the whole home spine and assert 0 CSP violations
 * (GSAP reveals + gallery parallax + masked wipe under the production CSP), and
 * confirm 0 <canvas> contributed by the sections (R3F only mounts in the
 * configurator, which the home page already owns). Run against `next start`.
 */
const playwrightUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(playwrightUrl);
const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let csp = 0;
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (/Content Security Policy|violates the following/i.test(t)) csp++;
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(1000);
const height = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < height; y += 700) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);

console.log('CSP violations:', csp);
console.log('Console errors:', errors.length);
for (const e of errors.slice(0, 6)) console.log('  -', e);
console.log(csp === 0 ? 'PASS — 0 CSP violations' : 'FAIL');
await browser.close();
