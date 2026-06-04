/**
 * Public client-side environment variables.
 *
 * Validated with light defaults so a missing `.env.local` does not break
 * the marketing page or the dashboard shell during local development —
 * the live status board (Phase 3.3) will degrade to an "Offline" SSE
 * state rather than a blank error when the API is unreachable.
 *
 * In the deployed topology (ADR-006) `apiUrl` and `sseUrl` collapse to
 * the same origin behind the `pulse-web` reverse proxy (the meld
 * single-origin precedent), which keeps the strict CSP `connect-src
 * 'self'` sufficient for both the dashboard fetches and the `EventSource`
 * SSE stream. Locally they point at the NestJS dev port.
 *
 * These are PUBLIC values only (inlined into the browser bundle). No
 * secret ever belongs here — server secrets live on `pulse-api`.
 */
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3080',
  sseUrl: process.env.NEXT_PUBLIC_SSE_URL ?? 'http://localhost:3080',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3081',
  /**
   * The slug of the example public status page (the seeded demo page, ADR-007).
   * Surfaced on the landing page as the "example public status page" link and
   * listed in the sitemap. Defaults to the seed's `demo` slug.
   */
  demoStatusSlug: process.env.NEXT_PUBLIC_DEMO_STATUS_SLUG ?? 'demo',
} as const;
