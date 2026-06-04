import { env } from '@/lib/env';
import type { PublicStatusPage } from 'pulse-server';

/**
 * REST client for the unauthenticated public status surface (Task 6.6).
 *
 *   GET /public/:slug -> the REDACTED public payload (ADR-003 / ADR-007):
 *     page title/description, public monitors (id + name + status + 30d
 *     uptime %), recent public incidents. NEVER raw response times, alert
 *     data, or private monitors — the shape itself has no field for them.
 *
 * This is a PUBLIC read: no `credentials` needed (the page is anonymous).
 * Used server-side for the SSR first paint (the SEO floor) and re-fetched
 * client-side for live reconciliation on the public SSE stream's reconnect.
 */

/** Raised so the SSR page can map a 404 slug to Next's notFound(). */
export class PublicStatusError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PublicStatusError';
    this.status = status;
  }
}

/**
 * Fetch the public status page. `signal`/`cache` are passed through so the SSR
 * render can opt into Next's data cache + revalidation (the page revalidates
 * cheaply; the live SSE stream carries the up-to-the-second updates).
 */
export async function getPublicStatusPage(
  slug: string,
  init?: { cache?: RequestCache; next?: { revalidate?: number } },
): Promise<PublicStatusPage> {
  const res = await fetch(`${env.apiUrl}/public/${encodeURIComponent(slug)}`, {
    headers: { accept: 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new PublicStatusError(
      res.status === 404 ? 'Status page not found' : 'Failed to load status page',
      res.status,
    );
  }
  return (await res.json()) as PublicStatusPage;
}

/** TanStack Query key for a public status page (client-side live reconcile). */
export function publicStatusQueryKey(slug: string): readonly string[] {
  return ['public-status', slug];
}
