// Reproduction probe for the "gallery pins too early (during services)" bug.
//
// Drives the BUILT + SERVED prod app on :3070 (NOT next dev) on a desktop
// viewport (>=1024, fine pointer, no reduced-motion). Scrolls incrementally
// from the top; at the scroll position where the SERVICES price list is
// centered in the viewport, it reads:
//   - the gallery track's translateX (the [data-gallery-frame] parent <ul>),
//   - whether the gallery <section id="gallery"> is currently pinned
//     (ScrollTrigger wraps a pinned element in a pin-spacer + writes a
//     transform; we detect both the pin-spacer wrapper and a non-zero track x).
// It captures a screenshot at the services scroll position.
//
// Usage (from projects/razors-edge/e2e):
//   OUT=./.repro BASE=http://localhost:3070 node repro-gallery-early-pin.mjs
//
// Run several times to catch the timing-sensitive intermittency.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3070';
const OUT = process.env.OUT ?? './.repro';
const TAG = process.env.TAG ?? 'run';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  // fine pointer + no reduced-motion are the desktop gallery gate. Playwright
  // chromium defaults to fine pointer; reducedMotion defaults to no-preference.
  reducedMotion: 'no-preference',
});
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// Let GSAP register + all sections' chunks resolve + the idle-deferred hero
// load. The hero is requestIdleCallback-scheduled (timeout 400ms); give it
// generous slack so the page reaches its settled trigger layout.
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2500);

// Helper: where is the services section, and what is the scroll position that
// centers its price list in the viewport?
const servicesY = await page.evaluate(() => {
  const el = document.querySelector('#services');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const absTop = rect.top + window.scrollY;
  // Center the services section in the viewport.
  return Math.round(absTop + rect.height / 2 - window.innerHeight / 2);
});

if (servicesY == null) {
  console.log(JSON.stringify({ error: 'no #services element' }));
  await browser.close();
  process.exit(1);
}

// Read a probe at a given scroll Y.
async function probeAt(y, label) {
  await page.evaluate((targetY) => window.scrollTo(0, targetY), y);
  // Let the scrub settle (scrub:1 eases). Two rAFs + a beat.
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const gallery = document.querySelector('#gallery');
    const track = document.querySelector('#gallery [data-gallery-frame]')
      ?.parentElement; // the <ul> track
    const services = document.querySelector('#services');

    const galleryRect = gallery?.getBoundingClientRect() ?? null;
    const servicesRect = services?.getBoundingClientRect() ?? null;

    // Track translateX from its computed matrix.
    let trackX = 0;
    if (track) {
      const t = getComputedStyle(track).transform;
      if (t && t !== 'none') {
        const m = new DOMMatrixReadOnly(t);
        trackX = Math.round(m.m41);
      }
    }

    // Pinned detection: ScrollTrigger wraps a pinned element in a
    // `.pin-spacer` and gives the pinned node `position: fixed` while pinned.
    const galleryStyle = gallery ? getComputedStyle(gallery) : null;
    const galleryParentIsPinSpacer =
      gallery?.parentElement?.classList.contains('pin-spacer') ?? false;
    const galleryPositionFixed = galleryStyle?.position === 'fixed';

    return {
      scrollY: Math.round(window.scrollY),
      innerHeight: window.innerHeight,
      servicesTop: servicesRect ? Math.round(servicesRect.top) : null,
      servicesBottom: servicesRect ? Math.round(servicesRect.bottom) : null,
      servicesInView:
        !!servicesRect &&
        servicesRect.top < window.innerHeight &&
        servicesRect.bottom > 0,
      galleryTop: galleryRect ? Math.round(galleryRect.top) : null,
      galleryParentIsPinSpacer,
      galleryPositionFixed,
      galleryPinned: galleryParentIsPinSpacer && galleryPositionFixed,
      trackX,
      trackTranslated: trackX < -2,
    };
  });
}

// Probe at the services-centered position.
const atServices = await probeAt(servicesY, 'services');
await page.screenshot({
  path: `${OUT}/${TAG}-at-services.png`,
  fullPage: false,
});

// Also probe a sweep so we can see where the gallery STARTS translating.
const sweep = [];
const maxY = await page.evaluate(
  () => document.documentElement.scrollHeight - window.innerHeight,
);
for (let y = 0; y <= maxY; y += 200) {
  // eslint-disable-next-line no-await-in-loop
  const p = await probeAt(y, `y${y}`);
  sweep.push({ y, trackX: p.trackX, pinned: p.galleryPinned, servicesInView: p.servicesInView, galleryTop: p.galleryTop });
}

// The first scroll position at which the track is translated.
const firstTranslate = sweep.find((s) => s.trackX < -2) ?? null;
// The first scroll position at which the gallery is pinned.
const firstPinned = sweep.find((s) => s.pinned) ?? null;

console.log(
  JSON.stringify(
    {
      TAG,
      servicesCenteredScrollY: servicesY,
      atServices,
      firstTrackTranslateAt: firstTranslate,
      firstPinnedAt: firstPinned,
      // Is the gallery already translated/pinned WHILE services is in view? (the bug)
      bugPresent:
        atServices.servicesInView &&
        (atServices.trackTranslated || atServices.galleryPinned),
    },
    null,
    2,
  ),
);

await browser.close();
