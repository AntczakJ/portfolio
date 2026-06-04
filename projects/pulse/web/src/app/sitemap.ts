import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';

/**
 * sitemap.xml (Task 6.6 SEO).
 *
 * Lists the public, indexable surfaces: the landing page and the example public
 * status page (the seeded `demo` slug, ADR-007). The authenticated dashboard is
 * not listed (it is private + disallowed in robots).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: env.siteUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${env.siteUrl}/status/${env.demoStatusSlug}`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 0.8,
    },
  ];
}
