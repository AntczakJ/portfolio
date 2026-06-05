// @ts-nocheck
/* eslint-disable */
/**
 * render-from-scene.mjs — RE-RENDER the offline outputs from the SAME rig + the
 * SAME real GLB as the live scene (D-02, D-04 / ADR-004 "one rig, three
 * outputs"). Drives the actual live R3F configurator headless (Playwright), sets
 * each colour×wheel combo via the real DOM controls, screenshots the live canvas
 * at the rig framing, and exports AVIF (sharp) into:
 *   public/renders/lumen-gt/matrix/        (light Tier-3 stills)
 *   public/renders/lumen-gt/matrix-dark/   (dark Tier-3 stills)
 *   public/renders/lumen-gt/hero*.avif     (light hero crops — the LCP)
 *   public/renders/lumen-gt/hero-dark*.avif(dark night-studio hero crops)
 *   public/renders/lumen-gt/wheels/*.avif  (swatch thumbnails, cropped)
 *
 * This guarantees Tier-1 (live) and Tier-3 (stills) are LITERALLY the same car
 * (closes D-02) and the hero LCP is a real studio frame from the GLB (closes
 * D-04). The old hand-drawn SVG generator is retired (see CREDITS.md).
 *
 * Run AGAINST an already-running `next start` (default port 3090):
 *   node scripts/render-from-scene.mjs [port]
 *
 * Requires the configurator capability gate to resolve tier-1 in chromium
 * (it does — desktop, WebGL2, >=4 cores). We force a wide viewport + a fine
 * pointer so the gate never routes to Tier-3 here.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const playwrightUrl = new URL(
  '../../../../node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/index.mjs',
  import.meta.url,
).href;
const { chromium } = await import(playwrightUrl);

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERS_DIR = join(HERE, '..', 'public', 'renders', 'lumen-gt');
const GALLERY_DIR = join(HERE, '..', 'public', 'gallery');
const PORT = process.argv[2] ?? '3090';
const BASE = `http://localhost:${PORT}`;

const COLORS = ['col-glacier', 'col-graphite', 'col-voltaic', 'col-midnight'];
const WHEELS = ['whl-aero', 'whl-turbine', 'whl-forged'];

/**
 * Capture the live canvas as a PNG buffer via a CLIPPED PAGE screenshot over the
 * stage box. We avoid Playwright's element-screenshot path because its internal
 * "wait for element to be stable" stalls on the live canvas (AdaptiveDpr can
 * resize the backing store, and the reveal opacity is animated). A clipped page
 * screenshot does no per-element stability wait. The context emulates
 * reduced-motion so auto-orbit is OFF and the scene is a static rest pose; the
 * render-harness CSS forces the still hidden + the canvas opaque so the clip
 * captures the live GLB, not the pre-baked still.
 */
async function shootCanvas(page) {
  const stage = page.locator('[data-configurator-stage]').first();
  await page.locator('#configurator canvas').first().waitFor({
    state: 'attached',
    timeout: 30000,
  });
  await page.waitForTimeout(650);
  const box = await stage.boundingBox();
  if (!box) throw new Error('stage box not found');
  return page.screenshot({ type: 'png', clip: box });
}

/**
 * Set a colour + wheel via the real DOM radios. The inputs are `sr-only` (so
 * Playwright's `.check()` actionability times out); we set `.checked` and
 * dispatch a native `change` so React's `onChange` fires exactly as a click
 * would — driving the same Zustand store the live scene reads.
 */
async function setConfig(page, colorId, wheelId) {
  // Native `.click()` on the (sr-only) radio fires React's delegated onChange
  // exactly like a user tap — driving the same Zustand store the scene reads.
  // (A `change`-event dispatch does NOT trigger React's radio handler.)
  await page.evaluate(
    ({ colorId, wheelId }) => {
      document
        .querySelector(`input[name="apex-color"][value="${colorId}"]`)
        ?.click();
      document
        .querySelector(`input[name="apex-wheel"][value="${wheelId}"]`)
        ?.click();
    },
    { colorId, wheelId },
  );
  await page.waitForTimeout(450);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(t);
  }, theme);
  await page.waitForTimeout(500);
}

/**
 * Rotate the model under the fixed rig camera by setting the offline yaw
 * override (`window.__APEX_YAW`, read by lumen-model.tsx) and then toggling the
 * config so React re-renders the model with the new yaw (the override is read at
 * render time, not reactively). A null yaw clears the override (back to the
 * shipped front 3/4). Used for the gallery crops (A-01): profile + rear 3/4.
 */
async function setYaw(page, yaw) {
  await page.evaluate((y) => {
    if (y === null) delete window.__APEX_YAW;
    else window.__APEX_YAW = y;
  }, yaw);
}

async function avif(buf, out, w, h, fit = 'contain') {
  await mkdir(dirname(out), { recursive: true });
  await sharp(buf)
    .resize(w, h, {
      fit,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .avif({ quality: 64, effort: 6 })
    .toFile(out);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 2,
    // Force a fine pointer so detectWebglTier() never treats us as mobile.
    hasTouch: false,
    isMobile: false,
    // Reduced-motion: the stage runs the scene at its static rest pose with NO
    // auto-orbit, so the canvas backing store is stable for the clipped shot
    // (and the reveal is an immediate crossfade we then force opaque via CSS).
    reducedMotion: 'reduce',
  });

  console.log(`Loading ${BASE} …`);
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  // Render-harness CSS: (1) hide the decorative "Drag to orbit" pill, (2) kill
  // the reveal crossfade transitions and force the canvas wrapper fully opaque +
  // the still hidden, so the canvas element is STABLE and fully visible for the
  // element screenshot (Playwright refuses to shoot a mid-transition element).
  await page.addStyleTag({
    content: `
      #configurator p[aria-hidden="true"]{display:none !important;}
      /* Hide the decorative "Drag to orbit" pill so it never bleeds into a
         gallery/hero crop (it sits bottom-right of the stage). */
      [data-configurator-stage] .absolute.right-4.bottom-4{display:none !important;}
      [data-configurator-stage] *{transition:none !important;}
      /* Force the live-canvas wrapper opaque and the pre-baked still hidden so
         the clipped page screenshot captures the LIVE GLB, not the still. The
         canvas wrapper is the FIRST .absolute.inset-0 child; the still wrapper
         is the SECOND. */
      [data-configurator-stage] > div > div.absolute.inset-0:first-child{opacity:1 !important;}
      [data-configurator-stage] > div > div.absolute.inset-0:nth-child(2){opacity:0 !important;}
    `,
  });
  await page.locator('#configurator').scrollIntoViewIfNeeded();
  // Wait for the live canvas (tier-1) to ATTACH (it mounts at opacity 0 behind
  // the still until reveal-when-ready; we screenshot its pixels regardless).
  await page.waitForSelector('#configurator canvas', {
    state: 'attached',
    timeout: 45000,
  });
  await page.waitForTimeout(2000);

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    const matrixDir = theme === 'dark' ? 'matrix-dark' : 'matrix';
    const suffix = theme === 'dark' ? '-dark' : '';

    for (const colorId of COLORS) {
      for (const wheelId of WHEELS) {
        await setConfig(page, colorId, wheelId);
        const png = await shootCanvas(page);
        const out = join(RENDERS_DIR, matrixDir, `${colorId}__${wheelId}.avif`);
        await avif(png, out, 1400, 1000, 'cover');
        console.log(`  ${theme}  ${colorId} / ${wheelId}`);
      }
    }

    // Hero crops from a PREMIUM DARK paint (Graphite + Aero) — the LCP frame.
    // (designer-critic P0-1: graphite reads premium; Glacier White read as a
    // featureless grey block. White stays selectable; only the hero default
    // presentation changed — it now matches the graphite configurator default.)
    await setConfig(page, 'col-graphite', 'whl-aero');
    const heroPng = await shootCanvas(page);
    await avif(heroPng, join(RENDERS_DIR, `hero${suffix}.avif`), 1600, 900, 'cover');
    await avif(heroPng, join(RENDERS_DIR, `hero-desktop${suffix}.avif`), 1920, 1080, 'cover');
    // The mobile crop is sized for a phone viewport (≤ ~440 CSS px at DPR 2-3):
    // 760×940 keeps it crisp on a 3× phone while shrinking the LCP payload vs the
    // old 900×1100 (mobile-perf B: smaller LCP byte-weight on the critical path).
    await avif(heroPng, join(RENDERS_DIR, `hero-mobile${suffix}.avif`), 760, 940, 'cover');
    console.log(`  ${theme}  hero crops`);
  }

  // Wheel swatch thumbnails (PASS B caveat fix). Shot against GRAPHITE paint —
  // NOT the default glacier white — so the rim reads with contrast (on white
  // paint a polished-silver rim near-disappears; the three wheel geometries then
  // all look the same in the thumb). A dark body throws the rim spokes into
  // relief, and a TIGHTER square crop centred on the front wheel shows the rim
  // geometry difference (aero disc vs turbine vs forged) clearly at 48 px.
  await setTheme(page, 'light');
  for (const wheelId of WHEELS) {
    await setConfig(page, 'col-graphite', wheelId);
    const png = await shootCanvas(page);
    // The prominent FRONT wheel (facing camera, rim visible) sits at ~0.52 x /
    // ~0.73 y of the 1.5:1 stage in the 3/4-front rig framing. Crop a square
    // centred there so the swatch thumb shows the rim geometry (aero disc vs
    // turbine vs forged), not a body panel. Clamped to the frame.
    const meta = await sharp(png).metadata();
    const side = Math.round(Math.min(meta.width, meta.height) * 0.24);
    let left = Math.round(meta.width * 0.52 - side / 2);
    let top = Math.round(meta.height * 0.73 - side / 2);
    left = Math.max(0, Math.min(left, meta.width - side));
    top = Math.max(0, Math.min(top, meta.height - side));
    const cropped = await sharp(png)
      .extract({ left, top, width: side, height: side })
      .toBuffer();
    await avif(
      cropped,
      join(RENDERS_DIR, 'wheels', `${wheelId.replace('whl-', '')}.avif`),
      200,
      200,
      'cover',
    );
    console.log(`  wheel thumb ${wheelId} (graphite, tight crop)`);
  }

  // --- Gallery crops from the REAL GLB (A-01) -------------------------------
  // Art-directed studio crops of the actual flagship — the gallery now reveals
  // the configurable car, not abstract glyphs. Each is a different framing of
  // the SAME model on the SAME studio rig (so it reads as one product shoot),
  // light + dark. The masked-wipe + parallax mechanics in gallery-section.tsx
  // already exist; this gives them subjects worth revealing.
  //   - hero-3q     : the signature front 3/4 (graphite, NEUTRAL aero wheel — N-2)
  //   - wheel-detail: a tight crop over the front wheel (forged/racing — the ONE
  //                   accent wheel frame, N-2)
  //   - profile     : the car yawed to a near-side profile (neutral aero)
  //   - rear-3q     : the car yawed to a rear 3/4 (neutral turbine)
  // N-2: the ESTABLISHING shots (hero/profile/rear) use the NEUTRAL default
  // wheel; the accent (forged/racing) wheel is reserved for the dedicated
  // wheel-detail frame only, so the gallery doesn't lead with an accent finish.
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    const suffix = theme === 'dark' ? '-dark' : '';

    // hero-3q — front 3/4, graphite paint + NEUTRAL aero wheels, default yaw.
    await setYaw(page, null);
    await setConfig(page, 'col-graphite', 'whl-aero');
    let png = await shootCanvas(page);
    await avif(png, join(GALLERY_DIR, `hero-3q${suffix}.avif`), 2000, 1125, 'cover');
    console.log(`  ${theme}  gallery hero-3q`);

    // wheel-detail — tight crop over the front wheel (the ONE accent wheel).
    await setConfig(page, 'col-graphite', 'whl-forged');
    png = await shootCanvas(page);
    {
      const meta = await sharp(png).metadata();
      const cw = Math.round(meta.width * 0.46);
      const ch = Math.round(cw * 1.25); // 4:5 portrait
      const left = Math.round(meta.width * 0.24);
      const top = Math.min(
        Math.round(meta.height * 0.42),
        Math.max(0, meta.height - ch),
      );
      const cropped = await sharp(png)
        .extract({ left, top, width: cw, height: Math.min(ch, meta.height - top) })
        .toBuffer();
      await avif(cropped, join(GALLERY_DIR, `wheel-detail${suffix}.avif`), 1200, 1500, 'cover');
    }
    console.log(`  ${theme}  gallery wheel-detail`);

    // profile — yaw the car to a near-side profile.
    await setYaw(page, Math.PI * 0.5);
    await setConfig(page, 'col-midnight', 'whl-aero');
    png = await shootCanvas(page);
    await avif(png, join(GALLERY_DIR, `profile${suffix}.avif`), 2000, 1250, 'cover');
    console.log(`  ${theme}  gallery profile`);

    // rear-3q — yaw the car to a rear 3/4. P1-D: shot in MIDNIGHT (was Glacier
    // White, which showed a featureless white block under premium copy — the one
    // off-register gallery frame). Now all four gallery frames are dark/premium.
    await setYaw(page, Math.PI * 1.04);
    await setConfig(page, 'col-midnight', 'whl-turbine');
    png = await shootCanvas(page);
    await avif(png, join(GALLERY_DIR, `rear-3q${suffix}.avif`), 2000, 1125, 'cover');
    console.log(`  ${theme}  gallery rear-3q`);

    // Restore default yaw for any later steps.
    await setYaw(page, null);
  }

  // --- FLEET card renders from the SAME rig (model-swap PASS B / N-1) -------
  // The four non-flagship fleet cards must read as siblings of the flagship's
  // real configurator render — one studio line-up. We drive the SAME live R3F
  // scene (same rig camera, same studio lighting, same clearcoat paint
  // mechanism) but swap in each fleet BODY GLB (its own bundled wheels) via the
  // offline window overrides, give each a tasteful default paint for colour
  // variety, and shoot the card AVIF (light + dark). This REPLACES the old
  // procedural-SVG jellybean fleet silhouettes (closes designer-critic N-1).
  const FLEET = [
    // slug, fleet body GLB, paint, scale. P1-A: `scale` length-normalises each
    // silhouette to ~2.7 m apparent length under the fixed rig so all five fleet
    // cards (flagship + four) read as ONE studio line-up with equal footprint
    // (scale = 2.7 / body-length; lengths from the GLB bounds: stratos 2.55,
    // terra 2.70, vella 2.55, mira 2.85). Grounded uniform scale (wheels stay on
    // the floor). Premium dark/voltaic per-car paint for colour variety.
    {
      slug: 'stratos',
      url: '/models/fleet/stratos.glb',
      paint: { color: '#16243f', metalness: 0.72, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.16 }, // midnight
      scale: 1.06,
    },
    {
      slug: 'terra',
      url: '/models/fleet/terra.glb',
      paint: { color: '#2b313a', metalness: 0.66, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.22 }, // graphite
      scale: 1.0,
    },
    {
      slug: 'vella',
      url: '/models/fleet/vella.glb',
      paint: { color: '#5b6470', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 }, // gunmetal silver
      scale: 1.06,
    },
    {
      slug: 'mira',
      url: '/models/fleet/mira.glb',
      paint: { color: '#18c08a', metalness: 0.4, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.14 }, // voltaic
      scale: 0.95,
    },
  ];

  // The offline overrides are read ONCE in `LumenModel` via a `useMemo([])` at
  // mount, so a post-mount `window.__APEX_BODY_URL` change does NOT swap the
  // body. To render a fleet body we open a FRESH page per car with the globals
  // set via `addInitScript` BEFORE any page script runs (so the override is
  // captured at the fresh mount). A fresh page per car avoids init-script
  // accumulation + reload slowdown (which timed the dark pass out).
  const harnessCss = `
    #configurator p[aria-hidden="true"]{display:none !important;}
    [data-configurator-stage] .absolute.right-4.bottom-4{display:none !important;}
    [data-configurator-stage] *{transition:none !important;}
    [data-configurator-stage] > div > div.absolute.inset-0:first-child{opacity:1 !important;}
    [data-configurator-stage] > div > div.absolute.inset-0:nth-child(2){opacity:0 !important;}
  `;
  async function shootFleetCar(car, theme, suffix) {
    const fp = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      deviceScaleFactor: 2,
      hasTouch: false,
      isMobile: false,
      reducedMotion: 'reduce',
    });
    await fp.addInitScript(
      ({ url, paint, scale }) => {
        window.__APEX_BODY_URL = url;
        window.__APEX_PAINT = paint;
        window.__APEX_OWN_WHEELS = true;
        window.__APEX_MODEL_SCALE = scale;
      },
      { url: car.url, paint: car.paint, scale: car.scale },
    );
    await fp.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await fp.addStyleTag({ content: harnessCss });
    await setTheme(fp, theme);
    await fp.locator('#configurator').scrollIntoViewIfNeeded();
    await fp.waitForSelector('#configurator canvas', { state: 'attached', timeout: 45000 });
    await fp.waitForTimeout(2400); // let the new body GLB load + paint
    const png = await shootCanvas(fp);
    await avif(png, join(RENDERS_DIR, '..', car.slug, `hero${suffix}.avif`), 1280, 800, 'cover');
    console.log(`  ${theme}  fleet ${car.slug}`);
    await fp.close();
  }

  for (const theme of ['light', 'dark']) {
    const suffix = theme === 'dark' ? '-dark' : '';
    for (const car of FLEET) {
      await shootFleetCar(car, theme, suffix);
    }
  }
  // The original `page` was never given fleet overrides, so it still shows the
  // flagship — reuse it for the blur pass (re-assert the still-hidden harness).

  // Blur placeholders — one per theme (D-16: the dark stage/hero must not flash
  // the light blur). Paste both into src/components/hero/hero-assets.ts.
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    // Blur matches the new graphite hero default (no light flash before decode).
    await setConfig(page, 'col-graphite', 'whl-aero');
    const blurPng = await shootCanvas(page);
    const blur = await sharp(blurPng)
      .resize(16, 9, { fit: 'cover' })
      .avif({ quality: 40 })
      .toBuffer();
    const file = theme === 'dark' ? 'hero-blur-dark.txt' : 'hero-blur.txt';
    await writeFile(
      join(RENDERS_DIR, file),
      `data:image/avif;base64,${blur.toString('base64')}`,
      'utf8',
    );
    console.log(`  ${file}`);
  }

  await browser.close();
  console.log('\nDone — matrix (light+dark) + hero crops + wheel thumbs + blur from the LIVE rig + GLB.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
