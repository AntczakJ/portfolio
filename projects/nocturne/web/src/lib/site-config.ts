/**
 * Site-level constants. `SITE_URL` is baked at build time for canonical / OG /
 * JSON-LD (the meld lesson — ADR-005 pending); falls back to the local dev
 * origin so metadata resolves during `next dev` / `next build` without the env.
 */
export const SITE_NAME = 'NOCTURNE';
export const SITE_DESCRIPTION =
  'A GPU audio-reactive generative particle field — hundreds of thousands of particles flowing through a curl-noise vector field, breathing in real time with music, finished with cinematic post-processing.';
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';
