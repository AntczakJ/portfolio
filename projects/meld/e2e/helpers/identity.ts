import type { BrowserContext, Cookie } from '@playwright/test';

/**
 * `identity.ts` — read / parse / clear the `meld_session` cookie that
 * ADR-005 pins as the source of truth for anonymous identity.
 *
 * The cookie value is a UUID v4 (36-char hyphenated lowercase). The
 * emoji + name + per-board color are derived deterministically from
 * the value by the server — the WS welcome frame carries the resolved
 * triple. The cookie itself is the only thing the e2e harness needs
 * to assert "identity persists across reloads" without spelunking the
 * welcome-store internals.
 */

export const SESSION_COOKIE_NAME = 'meld_session';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface SessionCookie {
  value: string;
  attributes: Cookie;
}

/**
 * Reads the `meld_session` cookie from the BrowserContext's cookie jar.
 * Returns `null` if not present (first-paint window before any
 * `/api/session` round-trip).
 */
export async function readSessionCookie(
  context: BrowserContext,
): Promise<SessionCookie | null> {
  const cookies = await context.cookies();
  const found = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  if (found === undefined) return null;
  return { value: found.value, attributes: found };
}

/**
 * Type-guard: a session cookie value is a valid UUID v4.
 */
export function isValidSessionValue(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

/**
 * Clear ONLY the `meld_session` cookie — preserves any third-party
 * cookies a test deliberately set. `context.clearCookies()` is the
 * blunt option; this preserves selectivity for tests that want to
 * keep theme preferences or similar.
 */
export async function clearSessionCookie(
  context: BrowserContext,
): Promise<void> {
  await context.clearCookies({ name: SESSION_COOKIE_NAME });
}
