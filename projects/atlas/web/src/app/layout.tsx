import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site-config';
// Side-effect FIRST: configure zod jitless at the root of every route's module
// graph so no validator on any route JIT-compiles a `new Function` probe under
// the strict no-`unsafe-eval` CSP (load-bearing for the live WS validation).
import '@/lib/zod-config';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Root layout — Atlas control-room shell.
 *
 * Fonts (Task 2.1): two OFL-licensed faces, self-hosted by next/font (no
 * runtime Google request — CSP-clean, no third-party `font-src`):
 *   - IBM Plex Sans → `--font-atlas-sans` (UI + body; a precise, technical
 *                      grotesk with an engineering register — the control-room
 *                      voice, distinct from apex's Inter/Space Grotesk)
 *   - IBM Plex Mono → `--font-atlas-mono` (live telemetry numerals: coords,
 *                      speeds, ETAs, tick counters — data reads as instrument
 *                      output, with tabular figures via globals.css)
 * Both expose CSS variables bound on <html>; globals.css `--font-sans` /
 * `--font-mono` reference them with a system fallback.
 *
 * `<html>` carries `suppressHydrationWarning` because next-themes mutates the
 * class on the client before React hydrates (the documented pattern). DARK is
 * the canonical default, so the server renders the dark control-room token set
 * from `:root` and there is no light flash.
 * --------------------------------------------------------------------- */

const atlasSans = IBM_Plex_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-atlas-sans',
  weight: ['400', '500', '600', '700'],
});

const atlasMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-atlas-mono',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — live fleet operations`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'fleet tracking',
    'live map',
    'geospatial',
    'real-time telemetry',
    'WebSocket',
    'geofence',
    'operations console',
  ],
  authors: [{ name: 'Jan Antczak' }],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: `${SITE_NAME} — live fleet operations`,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — live fleet operations`,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b1018' },
    { media: '(prefers-color-scheme: light)', color: '#eef1f5' },
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
      className={`${atlasSans.variable} ${atlasMono.variable}`}
    >
      <body className="antialiased">
        <Providers>
          <a
            href="#main"
            className="border-border bg-surface text-foreground sr-only z-50 rounded-md border px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
