/**
 * Site-wide constants (Phase 2 scaffold).
 *
 * `SITE_URL` is read from `NEXT_PUBLIC_SITE_URL` (baked at build) and falls back
 * to the dev origin (port 3093 — the architect-confirmed Atlas web port) so
 * `metadataBase` always resolves. Phase 9 wires the real Fly production URL.
 */
export const SITE_NAME = 'Atlas';

export const SITE_DESCRIPTION =
  'A live operations map. Watch a server-authoritative fleet glide in real time over a keyless map, with route trails, live ETAs, and geofence events firing as vehicles cross zones.';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3093';
