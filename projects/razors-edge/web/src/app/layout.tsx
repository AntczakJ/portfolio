import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { GrainOverlay } from '@/components/chrome/grain-overlay';
import { SiteFooter } from '@/components/chrome/site-footer';
import { SiteHeader } from '@/components/chrome/site-header';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site-config';
import { ShopJsonLd } from '@/components/seo/shop-json-ld';
// Side-effect FIRST (D-CSP-1): configure zod jitless at the root of every
// route's module graph so no validator on any route can JIT-compile a
// `new Function` probe under the strict no-`unsafe-eval` CSP.
import '@/lib/zod-config';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Fonts (Task 2.2) — both open-licensed (SIL Open Font License 1.1), no
 * licensing ambiguity for a public web embed, both served self-hosted by
 * next/font (no runtime Google request, no layout-shift, CSP-clean).
 *
 *  - Fraunces (display): a variable "old-style" display serif with real
 *    editorial character — high stroke contrast and a soft/wonk axis that
 *    reads as confident, hand-honed, luxe. Its `opsz` (optical size) and
 *    `wght` axes drive the RAZOR'S EDGE wordmark + section headers and the
 *    kinetic-weight idle shimmer the hero wants (ADR-004). A display serif
 *    over a generic grotesque is the deliberate "specimen, not a logo"
 *    call (Klim reference in docs/inspirations.md). SOFT axis is exposed.
 *  - Inter (sans): the variable workhorse for body + UI — the Linear /
 *    Stripe register, excellent at small sizes, supports an animatable
 *    weight axis. Clean and refined without competing with the serif.
 *
 * Both expose CSS variables (`--font-fraunces`, `--font-inter`) that
 * globals.css binds to the `--font-display` / `--font-sans` hooks.
 * `display: 'swap'` so no webfont blocks the LCP portrait paint (ADR-004).
 * --------------------------------------------------------------------- */
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['opsz', 'SOFT'],
  // Italic carries Fraunces' character; the wordmark/headers use roman,
  // but keeping both styles available costs little and supports editorial
  // pull-quotes in the testimonial section later.
  style: ['normal', 'italic'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

/* -------------------------------------------------------------------------
 * Root layout — Phase 1 scaffold shell.
 *
 * `<html>` carries `suppressHydrationWarning` because next-themes
 * mutates the class on the client before React hydrates (the standard,
 * documented next-themes pattern — without it React warns on the
 * server/client class mismatch). Dark is the canonical default, so the
 * server renders the dark token set from :root and there is no light
 * flash.
 *
 * The persistent chrome (sticky header, grain layer, footer) lands in
 * Phase 3 (Task 3.1). For now the shell is just Providers + children so
 * the placeholder hero and the GSAP smoke can mount.
 * --------------------------------------------------------------------- */

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'barbershop',
    'grooming',
    "men's haircuts",
    'beard',
    'shave',
    'booking',
  ],
  authors: [{ name: 'Jan Antczak' }],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f0c08' },
    { media: '(prefers-color-scheme: light)', color: '#f6f3ec' },
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
      className={`${fraunces.variable} ${inter.variable}`}
    >
      <body className="antialiased">
        {/* HairSalon / LocalBusiness JSON-LD (CLAUDE.md § 4 SEO). Server-built
            from the SHOP mock; rendered before hydration so crawlers always
            see it. */}
        <ShopJsonLd />
        <Providers>
          <GrainOverlay />
          <a
            href="#main"
            className="bg-surface text-fg focus-visible:ring-ring sr-only z-[60] rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:ring-2"
          >
            Skip to content
          </a>
          <SiteHeader />
          <div className="bg-background text-foreground relative z-[2] flex min-h-dvh flex-col">
            {children}
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
