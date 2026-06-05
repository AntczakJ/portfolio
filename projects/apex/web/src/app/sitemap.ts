import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

/**
 * sitemap.xml (CLAUDE.md § 4 SEO). Scaffold lists the home route; the full
 * route set (incl. `/reserve`) is added as those pages land (Phase 5 / 8).
 *
 * Uses a fixed `lastModified` (the frozen-clock discipline; no `new Date()`
 * in render so the output is deterministic for tests/screenshots).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: '2026-06-04',
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
