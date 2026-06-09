import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

/**
 * robots.txt (Next file convention -> `/robots.txt`). atrium is the
 * portfolio's public front door: the whole page is public and indexable.
 * There are no private areas (no auth, no backend, no forms), so the only
 * pointer is to the sitemap. The per-project sections are anchors on `/`,
 * not separate URLs, so there is nothing to disallow.
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
