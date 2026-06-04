import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { env } from '@/lib/env';
// Side-effect FIRST: configure zod jitless at the root of every route's
// module graph so no validator on any route (including the Phase 3 live
// SSE-envelope validator) can JIT-compile a `new Function` probe under
// the strict no-`unsafe-eval` CSP. The razors-edge fix, carried forward.
import '@/lib/zod-config';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Fonts (Task 3.2) — both open-licensed (SIL Open Font License 1.1), no
 * licensing ambiguity for a public web embed, both served self-hosted by
 * next/font (no runtime Google request, no layout shift, CSP-clean under
 * `font-src 'self'`).
 *
 *  - Geist (sans): Vercel's grotesque workhorse for body + UI — the exact
 *    clean-modern-SaaS register Pulse is judged against (Vercel / Linear).
 *    Crisp at small sizes, neutral, gets out of the data's way.
 *  - Geist Mono: the metric face — uptime %, response-time ms, monitor
 *    IDs, the "last checked Ns ago" ticker. The Linear / Vercel idiom is a
 *    tabular mono for the numbers a dashboard lives on so they do not
 *    jitter as they tick; globals.css also sets `tabular-nums` page-wide.
 *
 * Both expose CSS variables (`--font-geist-sans`, `--font-geist-mono`)
 * that globals.css binds to the `--font-sans` / `--font-mono` hooks.
 * `display: 'swap'` so no webfont blocks first paint.
 * --------------------------------------------------------------------- */
const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

/* -------------------------------------------------------------------------
 * Root layout — Phase 1 scaffold shell.
 *
 * `<html>` carries `suppressHydrationWarning` because next-themes mutates
 * the class on the client before React hydrates (the standard, documented
 * next-themes pattern). The default theme is `system`; the light :root
 * tokens are the SSR fallback, so there is no flash on a light-canonical
 * brand.
 *
 * The per-surface chrome (the dashboard rail + top bar, the marketing
 * header) is composed inside each route's own segment rather than here,
 * because the authenticated dashboard and the public marketing / status
 * surfaces want different shells. The root layout stays minimal:
 * Providers + the font-variable hooks + the children.
 * --------------------------------------------------------------------- */

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: 'Pulse — uptime monitoring that proves itself',
    template: '%s — Pulse',
  },
  description:
    'Pulse is a real uptime monitor: scheduled probes hit your endpoints, a live status board updates over SSE, and incidents open and resolve themselves.',
  applicationName: 'Pulse',
  keywords: [
    'uptime monitor',
    'status page',
    'incident',
    'observability',
    'SSE',
    'real-time',
    'monitoring',
  ],
  authors: [{ name: 'Jan Antczak' }],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: 'Pulse — uptime monitoring that proves itself',
    description:
      'A real uptime monitor with a live, SSE-pushed status board and a self-managing incident timeline.',
    siteName: 'Pulse',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pulse — uptime monitoring that proves itself',
    description:
      'A real uptime monitor with a live, SSE-pushed status board and a self-managing incident timeline.',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfd' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d12' },
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
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only z-[60] rounded-md bg-card px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Skip to content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
