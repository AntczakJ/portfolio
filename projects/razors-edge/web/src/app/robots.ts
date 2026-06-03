import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

/**
 * robots.txt (Next file convention → `/robots.txt`). The whole site is
 * public and indexable; the only pointer is to the sitemap. No private
 * areas to disallow (the booking flow is a public demo with no auth).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
