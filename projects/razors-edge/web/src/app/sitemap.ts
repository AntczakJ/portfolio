import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

/**
 * XML sitemap (Next file convention → `/sitemap.xml`). The site is two
 * routes: the long-form marketing home (`/`) and the booking flow (`/book`).
 * The in-page sections are anchors on `/`, not separate URLs, so they are
 * not listed. `lastModified` is a fixed build-time instant (the content is
 * static + deterministic per the frozen-clock discipline).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-06-03T00:00:00Z');
  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/book`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
