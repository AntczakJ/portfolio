// @ts-nocheck
/**
 * optimize-preview-stills.mjs — the atrium v2 per-bay PREVIEW STILL optimizer.
 *
 * Reproducible, committed asset pipeline (the capture-readme-screenshots.mjs /
 * sharp precedent — sharp is already a devDependency of atrium-web). Reads ONE
 * representative, recruiter-legible hero screenshot per sibling project (a
 * theme-matched dark + light pair, all COMMITTED under
 * projects/<slug>/docs/screenshots/), crops every source to ONE consistent
 * aspect ratio (16:10, the dominant capture ratio so the crop is mostly a
 * down-scale, not a re-frame), and emits an optimized AVIF at a sensible max
 * width into src/assets/preview-stills/.
 *
 * Provenance: every source is the PORTFOLIO'S OWN screenshot of its own project
 * (see the PROVENANCE table below + projects/atrium/docs/preview-stills-shots/
 * README). No third-party assets, no remote hosts — img-src 'self' covers the
 * emitted stills with no CSP change.
 *
 * Output format: AVIF only. The stills are STATIC-IMPORTED by next/image
 * (`import tapeDark from '@/assets/preview-stills/tape-dark.avif'`), so they emit
 * into .next/static and need NO public/ dir (the atrium Dockerfile has no
 * web/public COPY — do not force one). They are served `unoptimized` (already
 * AVIF at the target width) so there is no /_next/image runtime round-trip and no
 * runtime sharp dependency on the Fly machine. AVIF is universally supported by
 * the evergreen browsers this portfolio targets; a webp/png fallback was judged
 * unnecessary and would only add weight (the brief left it to judgement).
 *
 * Run (from projects/atrium/web):
 *   node scripts/optimize-preview-stills.mjs
 *
 * Deterministic: fixed source list, fixed crop geometry, fixed encoder settings —
 * re-running reproduces byte-stable-enough output for review.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, statSync } from 'node:fs';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const SCREENS = resolve(WEB_ROOT, '..', '..'); // projects/
const OUT_DIR = join(WEB_ROOT, 'src', 'assets', 'preview-stills');

mkdirSync(OUT_DIR, { recursive: true });

/** One consistent target frame for every bay still — 16:10, max width 1120px. */
const TARGET_W = 1120;
const TARGET_H = Math.round((TARGET_W * 10) / 16); // 700

/**
 * The chosen representative shot per project (dark + light), with a one-line
 * rationale. Each source is committed under projects/<slug>/docs/screenshots/.
 * `gravity` lets a source crop to the legible region when its native ratio is not
 * 16:10 (e.g. apex 1440x900 = 16:10 already; tape/atlas 2880x1800 = 16:10 already;
 * razors 2880x1800 = 16:10). All chosen sources are already 16:10 or 16:10-near,
 * so the crop is a clean centre cover + downscale — no re-framing surprises.
 */
const SOURCES = [
  {
    slug: 'tape',
    why: 'the live Canvas2D footprint / orderflow chart — the thing tape IS',
    dark: 'tape/docs/screenshots/live-render-3.3-3.4.png',
    light: 'tape/docs/screenshots/live-render-light.png',
    gravity: 'centre',
  },
  {
    slug: 'meld',
    why: 'the collaborative whiteboard with live presence cursors',
    dark: 'meld/docs/screenshots/board-dark.png',
    light: 'meld/docs/screenshots/board-light.png',
    gravity: 'centre',
  },
  {
    slug: 'razors-edge',
    why: 'the cinematic dark-luxe hero wordmark — the blade-sweep showpiece frame',
    dark: 'razors-edge/docs/screenshots/hero-dark.png',
    light: 'razors-edge/docs/screenshots/hero-light.png',
    gravity: 'centre',
  },
  {
    slug: 'pulse',
    why: 'the live status board — the self-driving uptime monitor at a glance',
    dark: 'pulse/docs/screenshots/board-dark.png',
    light: 'pulse/docs/screenshots/board-light.png',
    gravity: 'centre',
  },
  {
    slug: 'apex',
    why: 'the WebGL 3D car configurator — apex IS the configurator, not the marketing hero',
    dark: 'apex/docs/screenshots/configurator-desktop-dark.png',
    light: 'apex/docs/screenshots/configurator-desktop-light.png',
    gravity: 'centre',
  },
  {
    slug: 'atlas',
    why: 'the MapLibre control-room dashboard — the live fleet map',
    dark: 'atlas/docs/screenshots/dashboard-dark.png',
    light: 'atlas/docs/screenshots/dashboard-light.png',
    gravity: 'centre',
  },
];

function kb(p) {
  return Math.round(statSync(p).size / 1024);
}

async function emit(srcRel, outName, gravity) {
  const src = join(SCREENS, srcRel);
  const out = join(OUT_DIR, outName);
  await sharp(src)
    .resize(TARGET_W, TARGET_H, { fit: 'cover', position: gravity })
    .avif({ quality: 52, effort: 6, chromaSubsampling: '4:2:0' })
    .toFile(out);
  return { out, kb: kb(out) };
}

async function run() {
  console.log(`atrium preview stills -> ${TARGET_W}x${TARGET_H} AVIF`);
  let total = 0;
  for (const s of SOURCES) {
    const d = await emit(s.dark, `${s.slug}-dark.avif`, s.gravity);
    const l = await emit(s.light, `${s.slug}-light.avif`, s.gravity);
    total += d.kb + l.kb;
    console.log(
      `  ${s.slug.padEnd(12)} dark ${String(d.kb).padStart(3)}KB  light ${String(
        l.kb,
      ).padStart(3)}KB   (${s.why})`,
    );
  }
  console.log(`  total added weight: ${total}KB across 12 stills`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
