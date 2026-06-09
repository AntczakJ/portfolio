import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { LightField } from '@/components/atmosphere/light-field';
import { SiteFooter } from '@/components/chrome/site-footer';
import { SiteHeader } from '@/components/chrome/site-header';
import { PortfolioJsonLd } from '@/components/seo/portfolio-json-ld';
import {
  AUTHOR_NAME,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from '@/lib/site-config';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Fonts (Task 2.2) — both open-licensed (SIL Open Font License 1.1), no
 * licensing ambiguity for a public web embed, both served self-hosted by
 * next/font (no runtime Google request, no layout shift, CSP-clean: they are
 * `font-src 'self'`).
 *
 *  - Bricolage Grotesque (display): a contemporary VARIABLE display grotesque
 *    with a structural, architectural character — flat-sided terminals, a
 *    confident editorial presence, and `opsz` (optical size) + `wght` axes. It
 *    drives the ATRIUM wordmark + the per-bay project titles and the kinetic
 *    title resolves (the weight/optical-size settle on bay lock-in — ADR-002/003,
 *    real-DOM type + `font-variation-settings`, no Club plugin). A structural
 *    grotesque (not a serif) is the deliberate "architecture of light, not warm
 *    photographic luxe" call that keeps atrium DISTINCT from razors-edge's
 *    Fraunces serif (AGENT_NOTES re-skin gate) while reading as a SPECIMEN, not a
 *    logo (Stripe / Klim references in docs/inspirations.md).
 *  - Inter (sans): the variable workhorse for body + UI — excellent at small
 *    sizes, an animatable weight axis, the neutral Linear/Stripe register that
 *    carries the pitches and chrome without competing with the display grotesque.
 *
 * Both expose CSS variables (`--font-bricolage`, `--font-inter`) that
 * globals.css references, with one alias so the existing `--font-display`
 * hook (which names `--font-fraunces` only for historical parity is NOT used
 * here): globals.css `--font-display` references `--font-fraunces`, so we alias
 * Bricolage's variable to that name via `variable: '--font-fraunces'` to keep
 * the token surface stable. `display: 'swap'` so no webfont blocks the LCP
 * wordmark paint.
 * --------------------------------------------------------------------- */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  // Alias to the `--font-fraunces` slot globals.css `--font-display` reads, so
  // the display-face token surface stays stable regardless of the chosen face.
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

/* -------------------------------------------------------------------------
 * Root layout — Phase 1/2 scaffold shell.
 *
 * `<html>` carries `suppressHydrationWarning` because next-themes mutates the
 * class on the client before React hydrates (the standard, documented
 * next-themes pattern). Dark is the canonical default, so the server renders the
 * dark token set from :root and there is no light flash.
 *
 * The persistent chrome (sticky header, volumetric-light layer, footer) lands
 * in Phase 3. The full SEO surface lives here and alongside: the per-page
 * metadata below (canonical via `NEXT_PUBLIC_SITE_URL`, OG + Twitter card), the
 * designed `opengraph-image.tsx` (auto-detected by Next as the OG/Twitter
 * image — no need to hand-list it here), `robots.ts` + `sitemap.ts`, and the
 * `<PortfolioJsonLd>` graph rendered in `<body>`. Because atrium is the eventual
 * portfolio ROOT (AGENT_NOTES "Cross-cutting"), this is authored as the
 * portfolio's PRIMARY metadata, not a sub-project's.
 * --------------------------------------------------------------------- */

const PAGE_TITLE = `${SITE_NAME} — The portfolio of ${AUTHOR_NAME}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: PAGE_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: AUTHOR_NAME, url: SITE_URL }],
  creator: AUTHOR_NAME,
  publisher: AUTHOR_NAME,
  keywords: [
    'Jan Antczak',
    'portfolio',
    'software engineer',
    'frontend engineer',
    'full-stack engineer',
    'Next.js',
    'React',
    'TypeScript',
    'GSAP',
    'WebGL',
    'web development',
  ],
  category: 'technology',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: PAGE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    // Match the sovereign `--color-bg` per theme (dark = warm near-black,
    // light = warm bone/limestone). The light value tracks the current
    // `--color-bg: oklch(0.96 0.009 85)` (~#f6f3eb) — the earlier `#f4f1ea`
    // predated the daylight-theme token shift.
    { media: '(prefers-color-scheme: dark)', color: '#1a1714' },
    { media: '(prefers-color-scheme: light)', color: '#f6f3eb' },
  ],
  width: 'device-width',
  initialScale: 1,
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${inter.variable}`}
    >
      <body className="antialiased">
        {/* Portfolio structured data (Person + WebSite + CollectionPage with an
            ItemList of the six showcases). Server-built from the typed project
            data; rendered before hydration so crawlers always see it. JSON-LD is
            data, not script — CSP-clean under the strict no-`unsafe-eval` policy. */}
        <PortfolioJsonLd />
        <Providers>
          <a
            href="#main"
            className="bg-surface text-fg focus-visible:ring-ring sr-only z-[60] rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:ring-2"
          >
            Skip to content
          </a>

          {/* The volumetric-warm-light field underlays the whole scroll (fixed,
              z-0, aria-hidden — Task 3.1). */}
          <LightField />

          {/* The post-hero sticky header (IO-driven reveal + aria-current — Task
              3.1). It is fixed/z-40, above the field and the content. */}
          <SiteHeader />

          {/* The scroll content sits above the light field. The footer is part of
              the shell so every route resolves into the designed footer. */}
          <div className="relative z-[2] flex min-h-dvh flex-col">
            {children}
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
