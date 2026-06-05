import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site-config';

/**
 * robots.txt (CLAUDE.md § 4 SEO). The real ruleset is finalised in Phase 8;
 * this scaffold allows all and points at the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
