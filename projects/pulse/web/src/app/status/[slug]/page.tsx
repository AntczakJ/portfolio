import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PublicStatusView } from '@/components/public/public-status-view';
import { MarketingHeader } from '@/components/marketing/marketing-header';
import { env } from '@/lib/env';
import {
  getPublicStatusPage,
  PublicStatusError,
} from '@/lib/api/public-status';
import {
  openIncidentCount,
  overallBanner,
} from '@/lib/public-status/public-status-view';
import type { PublicStatusPage } from 'pulse-server';

/**
 * The public status page (`/status/[slug]`) — Task 6.6, the shareable SEO
 * artifact.
 *
 * It SSRs from `GET /public/:slug` (the SEO floor: the first paint has the
 * real, redacted content for the crawler), then the client view live-updates
 * from the redacted public SSE stream. No auth, no client-only data dependency
 * for first paint. Light + dark. The success criterion is Lighthouse >= 95 in
 * all four categories on this surface.
 *
 * `revalidate` keeps the SSR payload cheap to serve under load (it is
 * rollup-backed) while the live SSE stream carries the up-to-the-second state
 * for an open viewer.
 */

export const revalidate = 30;

/** Fetch with a short revalidate so SSR is cached but fresh enough. */
async function loadPage(slug: string): Promise<PublicStatusPage | null> {
  try {
    return await getPublicStatusPage(slug, { next: { revalidate } });
  } catch (error) {
    if (error instanceof PublicStatusError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage(slug);

  if (!page) {
    return {
      title: 'Status page not found',
      robots: { index: false, follow: false },
    };
  }

  const banner = overallBanner(page.overall, openIncidentCount(page));
  // Avoid a doubled word when the page title already ends in "status".
  const title = /status\s*$/i.test(page.title)
    ? page.title
    : `${page.title} status`;
  const description =
    page.description ??
    `Live operational status and recent incidents for ${page.title}. ${banner.headline}.`;
  const canonical = `/status/${slug}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: canonical,
      title: `${page.title} — ${banner.headline}`,
      description,
      siteName: 'Pulse',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${page.title} — ${banner.headline}`,
      description,
    },
  };
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<ReactNode> {
  const { slug } = await params;
  const page = await loadPage(slug);

  if (!page) {
    notFound();
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <MarketingHeader />
      <main id="main" className="flex-1">
        {/* JSON-LD: a WebSite + the overall operational state as structured
            data, so the status surface is machine-readable for crawlers. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: buildJsonLd(slug, page) }}
        />
        <PublicStatusView slug={slug} initialData={page} />
      </main>
    </div>
  );
}

/**
 * Build the JSON-LD structured data for the status page. A `WebSite` node (the
 * page itself) carries the human title/description; we attach the current
 * operational state and the list of monitored services as a calm, valid graph.
 * Server-generated from the redacted payload only — no secret / private field
 * can appear here.
 */
function buildJsonLd(slug: string, page: PublicStatusPage): string {
  const url = `${env.siteUrl}/status/${slug}`;
  const banner = overallBanner(page.overall, openIncidentCount(page));

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': url,
        url,
        name: `${page.title} status`,
        description:
          page.description ??
          `Live operational status and recent incidents for ${page.title}.`,
        publisher: {
          '@type': 'Organization',
          name: 'Pulse',
        },
      },
      {
        '@type': 'WebPage',
        url,
        name: `${page.title} — ${banner.headline}`,
        isPartOf: { '@id': url },
        about: page.monitors.map((m) => ({
          '@type': 'WebAPI',
          name: m.name,
        })),
      },
    ],
  };

  return JSON.stringify(graph);
}
