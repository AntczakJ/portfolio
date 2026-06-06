import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    // The landing / public read surface — the SEO-bearing, static-rendered page.
    {
      url: `${SITE_URL}/about`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    // The live operations dashboard (client-only live first paint).
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];
}
