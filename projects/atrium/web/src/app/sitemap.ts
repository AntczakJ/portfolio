import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

/**
 * XML sitemap (Next file convention -> `/sitemap.xml`). atrium is a single
 * long-form scrolling landing page: there is exactly one route (`/`). The
 * six project bays and the directory/about/footer are in-page anchors on
 * `/` (`#bay-<slug>`), not separate URLs, so the canonical entry is `/`
 * alone. `lastModified` is a fixed build-time instant (the content is static
 * and deterministic per the frozen-clock discipline — no `Date.now()`).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-06-09T00:00:00Z');
  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
