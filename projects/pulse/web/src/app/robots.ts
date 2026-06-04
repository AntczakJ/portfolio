import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';

/**
 * robots.txt (Task 6.6 SEO).
 *
 * The public surfaces (the landing + the status pages) are indexable; the
 * authenticated dashboard is private and explicitly disallowed (it is
 * auth-gated and not an SEO target — the dashboard is exempt per the brief).
 * Points crawlers at the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard'],
      },
    ],
    sitemap: `${env.siteUrl}/sitemap.xml`,
    host: env.siteUrl,
  };
}
