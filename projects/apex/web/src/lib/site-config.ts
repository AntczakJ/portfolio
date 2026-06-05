/**
 * Site-wide constants (Phase 1 scaffold).
 *
 * `SITE_URL` is read from `NEXT_PUBLIC_SITE_URL` (baked at build, the
 * razors-edge ADR-005 deploy posture) and falls back to the dev origin so
 * `metadataBase` always resolves. Phase 8 wires the real production URL.
 */
export const SITE_NAME = 'APEX';

export const SITE_DESCRIPTION =
  'Premium electric vehicles, by the day. Configure your car and reserve in minutes.';

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3090';
