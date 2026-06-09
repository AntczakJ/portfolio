import type { ReactNode } from 'react';

import { PROJECTS } from '@/data/projects';
import {
  AUTHOR_EMAIL,
  AUTHOR_NAME,
  GITHUB_BASE,
  REPO_LINKS_LIVE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from '@/lib/site-config';

/**
 * Structured data for the portfolio front page (CLAUDE.md § 4 SEO). atrium is
 * authored as the portfolio's PRIMARY metadata (AGENT_NOTES "Cross-cutting" —
 * it is the eventual root), so the graph models the page itself, the author,
 * and the six showcases:
 *
 *   - `Person` (Jan Antczak) — the author the whole portfolio belongs to.
 *   - `WebSite` — the front door, with the canonical origin and the author as
 *     its author/creator.
 *   - `CollectionPage` carrying an `ItemList` of the six projects, each a
 *     `SoftwareApplication` (every showcase is a deployed web app) with its
 *     real public demo URL as `url`. The list order is the canonical portfolio
 *     order (it drives the on-page bay sequence too), encoded via
 *     `position` / `ItemListOrder.Ascending`.
 *
 * Emitted as a SINGLE `<script type="application/ld+json">`. This is DATA, not
 * executable script — `type="application/ld+json"` is never parsed as
 * JavaScript, so it does NOT require `script-src 'unsafe-eval'` and raises no
 * CSP violation under the strict no-`unsafe-eval` policy. (Verified under
 * `next build && next start`: zero `securitypolicyviolation` events.) Built
 * server-side from `PROJECTS` (the single typed source of truth — links and
 * stacks are never re-hardcoded here) so crawlers always see it pre-hydration.
 */
export function PortfolioJsonLd(): ReactNode {
  const personId = `${SITE_URL}/#person`;
  const websiteId = `${SITE_URL}/#website`;

  const person = {
    '@type': 'Person',
    '@id': personId,
    name: AUTHOR_NAME,
    email: `mailto:${AUTHOR_EMAIL}`,
    url: SITE_URL,
    jobTitle: 'Software Engineer',
    // The GitHub profile is only a real, navigable link once a remote exists
    // (the single REPO_LINKS_LIVE seam — ADR-003 / U2). Until then we omit it
    // rather than emit a placeholder that resolves to a 404.
    ...(REPO_LINKS_LIVE ? { sameAs: [GITHUB_BASE] } : {}),
  };

  const itemListElement = PROJECTS.map((project, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    item: {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#bay-${project.slug}`,
      name: project.name,
      description: project.pitch,
      url: project.demoUrl,
      applicationCategory: 'WebApplication',
      operatingSystem: 'Web',
      author: { '@id': personId },
      keywords: project.stack.join(', '),
      ...(REPO_LINKS_LIVE ? { codeRepository: project.repoUrl } : {}),
    },
  }));

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      person,
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        inLanguage: 'en',
        author: { '@id': personId },
        creator: { '@id': personId },
      },
      {
        '@type': 'CollectionPage',
        '@id': `${SITE_URL}/#portfolio`,
        name: `${SITE_NAME} — the portfolio of ${AUTHOR_NAME}`,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        isPartOf: { '@id': websiteId },
        about: { '@id': personId },
        primaryImageOfPage: `${SITE_URL}/opengraph-image`,
        mainEntity: {
          '@type': 'ItemList',
          name: 'Showcase projects',
          numberOfItems: PROJECTS.length,
          itemListOrder: 'https://schema.org/ItemListOrderAscending',
          itemListElement,
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inject (no user input — every value
      // comes from the typed, Zod-validated project data + site config);
      // escape `<` so the payload can never break out of the <script> element.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(graph).replace(/</g, '\\u003c'),
      }}
    />
  );
}
