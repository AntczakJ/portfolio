// @ts-nocheck
/* eslint-disable */
/**
 * Cinematic photography grade pipeline (Phase 3, Task 3.x).
 *
 * Sources royalty-clear barbershop / men's-grooming photography (Unsplash
 * License) downloaded into `public/images/` and applies ONE cohesive
 * dark-luxe treatment so an otherwise-mixed set reads as a single
 * cinematic frame: a warm brass-on-near-black duotone lean, lifted
 * contrast, gentle desaturation, and a radial vignette toward the
 * near-black ground. Outputs sized AVIF derivatives (next/image still
 * re-encodes per request, but baking the grade keeps the set unified
 * regardless of source) plus a tiny base64 blur placeholder per image.
 *
 * Run: `node scripts/grade-photography.mjs`. Re-runnable / idempotent.
 * Dev-only; the graded outputs ship statically. Not part of the build.
 */
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, 'public', 'images');
const OUT = join(root, 'public', 'images', 'graded');

/**
 * The grade. A duotone built from a near-black shadow and a brass
 * highlight, blended back over a contrast-lifted, slightly-desaturated
 * base so faces keep some natural tone while the whole set leans warm and
 * dark. Values tuned to the sovereign palette (brass-on-near-black).
 */
const SHADOW = { r: 18, g: 14, b: 9 }; // near-black warm ground
const HIGHLIGHT = { r: 224, g: 176, b: 104 }; // brass / amber

/** Build a radial-vignette PNG sized to the target, multiplied over the image. */
async function vignette(width, height, strength = 0.6) {
  const cx = width / 2;
  const cy = height / 2;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="v" cx="50%" cy="46%" r="75%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
        <stop offset="58%" stop-color="#ffffff" stop-opacity="1"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="${strength}"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#v)"/>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Duotone: map luminance to a shadow→highlight ramp, then mix back over
 * the toned original so it is a graded photo, not a flat two-tone poster.
 */
async function grade(inputBuffer, { width, height, vignetteStrength, position, saturation, brightness, duoMix }) {
  // 1. Base tone: resize/cover, lift contrast, desaturate HARD, warm.
  //    `position` art-directs the crop deliberately per slot (D-05) — the
  //    hero crops favour the subject's face + razor rather than auto-crop.
  //    D-03: the base is pushed much closer to monochrome here so the
  //    source's native colour/white-balance no longer leaks through — what
  //    unifies the set is the SHARED duotone below, not each photo's own
  //    lighting. Saturation is floored low for EVERY job (no per-source
  //    exception) so five different rooms collapse into one tonal world.
  const base = sharp(inputBuffer)
    .resize(width, height, { fit: 'cover', position: position ?? 'attention' })
    .modulate({ saturation: saturation ?? 0.5, brightness: brightness ?? 1.0 })
    .linear(1.18, -16) // contrast: slope + offset (darken shadows)
    .gamma(1.05);

  const baseBuf = await base.clone().toBuffer();

  // 2. Duotone layer from the base luminance: map shadows → warm near-black,
  //    highlights → brass, so the COLOUR of the frame is dictated entirely by
  //    the shared ramp regardless of the source. This is the single grade the
  //    whole set passes through (D-03: "shot in the same room under the same
  //    light").
  const gray = await sharp(baseBuf).greyscale().toBuffer();
  const duo = await sharp(gray)
    .tint(HIGHLIGHT) // highlights lean brass
    .modulate({ brightness: 1.0 })
    .toBuffer();

  // Floor the duotone shadows toward the warm near-black ground.
  const shadowFloor = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: SHADOW,
    },
  })
    .png()
    .toBuffer();

  const duoToned = await sharp(duo)
    .composite([{ input: shadowFloor, blend: 'screen' }])
    .toBuffer();

  // 3. Mix the duotone back over the base at a STRONG, uniform opacity so the
  //    set unifies in colour/temperature while faces keep some dimensionality.
  //    A single shared `duoMix` (0.78 default) is applied to all photography —
  //    the cohesion is the grade, not a per-image tweak.
  const duoOverlay = await sharp(duoToned)
    .ensureAlpha(duoMix ?? 0.78)
    .toBuffer();

  const composed = await sharp(baseBuf)
    .composite([
      { input: duoOverlay, blend: 'overlay' },
      { input: await vignette(width, height, vignetteStrength), blend: 'multiply' },
    ])
    .toBuffer();

  return composed;
}

async function emit(name, graded, width) {
  await mkdir(OUT, { recursive: true });
  const avifPath = join(OUT, `${name}.avif`);
  const jpgPath = join(OUT, `${name}.jpg`);
  await sharp(graded).avif({ quality: 58, effort: 6 }).toFile(avifPath);
  await sharp(graded).jpeg({ quality: 82, mozjpeg: true }).toFile(jpgPath);

  // Tiny blur placeholder (base64 data URL), 16px wide.
  const blur = await sharp(graded)
    .resize(16)
    .blur(1.2)
    .webp({ quality: 40 })
    .toBuffer();
  const dataUrl = `data:image/webp;base64,${blur.toString('base64')}`;
  return { name, width, dataUrl };
}

// Slot definitions — source file, output name, target size, vignette, crop.
// D-05: the hero reveal lands on `hero-d.jpg` — a dramatic, well-composed
// straight-razor shave portrait (face in profile, eyes closed, a real
// cut-throat razor mid-pass) that pays off "the work beneath / the finished
// cut" AND reinforces the razor motif. Art-directed per device: desktop keeps
// the full cinematic composition; mobile crops tall to the face + razor.
const JOBS = [
  // Hero — desktop cinematic landscape (revealed in the wordmark gap).
  { src: 'hero-d.jpg', name: 'hero-desktop', width: 1920, height: 1200, vignetteStrength: 0.7, position: 'centre' },
  // Hero — mobile tall crop, art-directed for the 320px reveal: a centred
  // tall crop keeps the face, the razor, and the barber's hands all in frame
  // (the subject spans the middle of the source) rather than the backdrop.
  { src: 'hero-d.jpg', name: 'hero-mobile', width: 1080, height: 1440, vignetteStrength: 0.6, position: 'attention' },
  // Gallery set (5). The old desktop-hero shave crop becomes a gallery frame.
  { src: 'g1.jpg', name: 'gallery-01', width: 1280, height: 1600, vignetteStrength: 0.55 },
  { src: 'hero-a.jpg', name: 'gallery-02', width: 1600, height: 1067, vignetteStrength: 0.6 },
  { src: 'hero-e.jpg', name: 'gallery-03', width: 1600, height: 900, vignetteStrength: 0.55 },
  { src: 'g2.jpg', name: 'gallery-04', width: 1280, height: 1600, vignetteStrength: 0.5 },
  { src: 'g3.jpg', name: 'gallery-05', width: 1600, height: 1067, vignetteStrength: 0.5 },
  // Barber portraits (Phase 4.3, D-03 unified re-grade). Real, royalty-clear
  // (Unsplash License) men's portrait headshots downloaded same-origin. The
  // five sources come from visibly different lighting setups (low-key studio
  // vs bright outdoor daylight with blown highlights and green/neutral
  // backgrounds), so on the cream LIGHT surface they previously read as a
  // five-photographer contact sheet. The fix (D-03): ALL FIVE pass through
  // the SAME grade — identical low saturation (0.5 via `grade` default),
  // identical strong duotone mix (`duoMix` 0.82, a touch stronger than the
  // gallery so the team grid is the most unified surface), identical 4:5 crop
  // and `top` face-attention positioning, and a common vignette. Only
  // `brightness` is allowed to differ — and ONLY to normalise the source
  // exposure so each face lands at the same key-light luminance, NOT to grade
  // them differently (bright daylight sources are pulled down, the dark
  // low-key source is lifted, so all five read "shot in the same room under
  // the same light").
  { src: 'barber-marco.jpg', name: 'barber-marco-vidal', width: 900, height: 1125, vignetteStrength: 0.55, position: 'top', duoMix: 0.82, brightness: 0.98 },
  { src: 'barber-idris.jpg', name: 'barber-idris-bello', width: 900, height: 1125, vignetteStrength: 0.55, position: 'top', duoMix: 0.82, brightness: 0.9 },
  { src: 'barber-sasha.jpg', name: 'barber-sasha-ren', width: 900, height: 1125, vignetteStrength: 0.55, position: 'top', duoMix: 0.82, brightness: 0.9 },
  { src: 'barber-emil.jpg', name: 'barber-emil-novak', width: 900, height: 1125, vignetteStrength: 0.55, position: 'top', duoMix: 0.82, brightness: 1.16 },
  { src: 'barber-jonah.jpg', name: 'barber-jonah-pike', width: 900, height: 1125, vignetteStrength: 0.55, position: 'top', duoMix: 0.82, brightness: 0.92 },
];

async function main() {
  const placeholders = {};
  for (const job of JOBS) {
    const input = await readFile(join(SRC, job.src));
    const graded = await grade(input, job);
    const { name, dataUrl } = await emit(job.name, graded, job.width);
    placeholders[name] = dataUrl;
    console.log(`graded ${job.src} -> ${name}.avif/.jpg (${job.width}x${job.height})`);
  }

  // Emit the blur-placeholder map as a TS module the slots import.
  const ts =
    `/* AUTO-GENERATED by scripts/grade-photography.mjs — do not edit by hand. */\n` +
    `/* Base64 blur placeholders (LQIP) for the graded photography set. */\n` +
    `export const BLUR_PLACEHOLDERS = ${JSON.stringify(placeholders, null, 2)} as const;\n` +
    `export type GradedImageName = keyof typeof BLUR_PLACEHOLDERS;\n`;
  await writeFile(join(root, 'src', 'mocks', 'image-placeholders.ts'), ts, 'utf8');
  console.log('wrote src/mocks/image-placeholders.ts');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
