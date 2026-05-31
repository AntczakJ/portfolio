/**
 * Public client-side environment variables.
 *
 * Validated with light defaults so a missing .env does not break the
 * landing page — the status row will show the API as offline instead.
 */
export const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001',
} as const;
