/**
 * Canonical site configuration — the single source of truth for the
 * deployed origin used by `metadataBase`, `sitemap.ts`, `robots.ts`, the
 * OG image, and the JSON-LD `url`/`@id`.
 *
 * The origin comes from `NEXT_PUBLIC_SITE_URL` (see `.env.example`); when
 * unset it falls back to a documented placeholder production URL so the
 * generated absolute URLs are sensible even before a real deploy. The local
 * dev/prod-test server runs on :3070, but the canonical metadata should
 * reflect the public origin, hence the placeholder rather than localhost.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://razors-edge-demo.vercel.app'
).replace(/\/$/, '');

export const SITE_NAME = "Razor's Edge";

export const SITE_DESCRIPTION =
  'An upscale grooming studio. Cuts, shaves, and beard work, by appointment.';
