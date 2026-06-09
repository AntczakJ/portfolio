// @ts-nocheck
/**
 * capture-readme-screenshots.mjs — curated README screenshot capture for atrium.
 *
 * Drives the BUILT + SERVED prod app on :3080 (NOT next dev — the strict CSP
 * forbids unsafe-eval, and next dev cannot run under it) and writes a curated,
 * high-quality set into projects/atrium/docs/screenshots/ (a COMMITTED location).
 *
 * Run pattern (from projects/atrium/e2e, after `pnpm -F atrium-web build` and
 * `pnpm -F atrium-web start`):
 *   node capture-readme-screenshots.mjs
 *
 * Determinism: atrium has no runtime randomness (no Date.now()/Math.random() in
 * render — the data is six fixed entries with a fixed `year`), so every frame is
 * reproducible without faking a clock.
 *
 * The hero pins ~1.3 viewports on desktop (ADR-003 / hero-descent.tsx); scrubbing
 * window.scrollY across that range captures the descent frames. The six bays each
 * pin in turn below it — scrolling to `#bay-<slug>` and settling captures a bay
 * locked into frame with its kinetic title resolved.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3080';

mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 };

/** Pre-seed the theme so the captured frame is not a flash of the default. */
async function seedTheme(context, theme) {
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t);
    } catch {}
  }, theme);
}

async function shot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  wrote', file);
}

/**
 * Scrub the pinned hero descent to a normalised progress (0..1) and settle.
 * The hero pins ~1.3vh on desktop; mapping progress onto window.scrollY gives a
 * descent frame. Done incrementally so ScrollTrigger's rAF scrub keeps up (an
 * instant jump can skip the scrub — the atrium AGENT_NOTES "use incremental
 * scroll, not a teleport" lesson).
 */
async function scrubHeroTo(page, progress, pinVh) {
  await page.evaluate(
    async ({ p, pin }) => {
      const target = Math.round(window.innerHeight * pin * p);
      const steps = 18;
      const start = window.scrollY;
      for (let i = 1; i <= steps; i += 1) {
        window.scrollTo(0, Math.round(start + ((target - start) * i) / steps));
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
    },
    { p: progress, pin: pinVh },
  );
  await page.waitForTimeout(500);
}

/**
 * Scroll a bay (or any id) into frame and settle on its RESOLVED state.
 *
 * A pinned bay resolves its kinetic title and reveals its pitch/stack/links as
 * the scroll scrubs THROUGH the pin — so landing exactly on the bay top catches
 * the title mid-resolve. `extraVh` over-scrolls past the top by a fraction of a
 * viewport so the capture lands on the fully-composed, locked-in bay frame.
 */
async function scrollToId(page, id, extraVh = 0) {
  await page.evaluate(
    async ({ anchor, extra }) => {
      const el = document.getElementById(anchor);
      if (!el) return;
      const targetTop =
        el.getBoundingClientRect().top + window.scrollY + window.innerHeight * extra;
      const steps = 30;
      const start = window.scrollY;
      for (let i = 1; i <= steps; i += 1) {
        window.scrollTo(0, Math.round(start + ((targetTop - start) * i) / steps));
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
    },
    { anchor: id, extra: extraVh },
  );
  await page.waitForTimeout(750);
}

async function run() {
  const browser = await chromium.launch();

  // ── Desktop, dark — hero descent + bays + directory + about + footer ─────
  {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      deviceScaleFactor: DESKTOP.deviceScaleFactor,
      colorScheme: 'dark',
    });
    await seedTheme(context, 'dark');
    const page = await context.newPage();

    console.log('Desktop dark — hero descent + bays');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    // Hero first paint — the ATRIUM wordmark in the shaft of light (the lead image).
    await scrubHeroTo(page, 0, 1.3);
    await shot(page, 'hero-dark');

    // Mid-descent — the wordmark drops through, the colonnade of light resolves.
    await scrubHeroTo(page, 0.5, 1.3);
    await shot(page, 'descent-mid-dark');

    // Late descent — the lit hall, handing off into the first bay.
    await scrubHeroTo(page, 0.85, 1.3);
    await shot(page, 'descent-late-dark');

    // The six gallery bays — representative captures (tape, razors-edge, atlas),
    // over-scrolled into each pin so the bay is fully resolved (title settled,
    // pitch + stack + links revealed), not caught mid-transition.
    await scrollToId(page, 'bay-tape', 0.45);
    await shot(page, 'bay-tape-dark');

    await scrollToId(page, 'bay-razors-edge', 0.45);
    await shot(page, 'bay-razors-edge-dark');

    await scrollToId(page, 'bay-atlas', 0.45);
    await shot(page, 'bay-atlas-dark');

    // The directory (arrival) — the fully-legible index.
    await scrollToId(page, 'directory');
    await shot(page, 'directory-dark');

    await context.close();
  }

  // ── Desktop, light — the architectural daylight register ─────────────────
  {
    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      deviceScaleFactor: DESKTOP.deviceScaleFactor,
      colorScheme: 'light',
    });
    await seedTheme(context, 'light');
    const page = await context.newPage();

    console.log('Desktop light — hero + bay');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    await scrubHeroTo(page, 0, 1.3);
    await shot(page, 'hero-light');

    await scrollToId(page, 'bay-tape', 0.45);
    await shot(page, 'bay-tape-light');

    await scrollToId(page, 'directory');
    await shot(page, 'directory-light');

    await context.close();
  }

  // ── Mobile, dark — hero + the unpinned bay stack ─────────────────────────
  {
    const context = await browser.newContext({
      viewport: { width: MOBILE.width, height: MOBILE.height },
      deviceScaleFactor: MOBILE.deviceScaleFactor,
      colorScheme: 'dark',
      isMobile: true,
      hasTouch: true,
    });
    await seedTheme(context, 'dark');
    const page = await context.newPage();

    console.log('Mobile dark — hero + bay');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await shot(page, 'hero-mobile-dark');

    await scrollToId(page, 'bay-tape');
    await shot(page, 'bay-tape-mobile-dark');

    await context.close();
  }

  await browser.close();
  console.log('\nDone. Screenshots in', OUT_DIR);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
