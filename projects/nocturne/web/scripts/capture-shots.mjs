// Fast canvas capture (software-GL friendly): arm the field, capture two
// presets via canvas.toDataURL (?capture preserves the drawing buffer). Skips
// the heavy diagnostics sampling — verify-engine.mjs covers that.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'engine-shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:3100/?tier=low&capture', { waitUntil: 'load' });
await page.getByRole('button', { name: /press to begin/i }).waitFor({ state: 'visible', timeout: 20000 });
await page.getByRole('button', { name: /press to begin/i }).click();

async function cap(name, waitMs) {
  await page.waitForTimeout(waitMs);
  const url = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  });
  if (!url) { console.log(name, 'FAILED'); return; }
  writeFileSync(join(SHOTS, name), Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
  console.log('shot:', name);
}

await cap('field-aurora.png', 6000);
const molten = page.getByRole('button', { name: /molten swirl/i });
if (await molten.isVisible().catch(() => false)) {
  await molten.click();
  await cap('field-molten-swirl.png', 6000);
}
await page.close();
await browser.close();
console.log('capture done');
