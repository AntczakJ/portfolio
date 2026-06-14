import type { Metadata, Viewport } from 'next';
import { Outfit, Sora } from 'next/font/google';
import type { ReactNode } from 'react';

import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site-config';
// Side-effect FIRST (ADR-002 §6): configure zod jitless at the root of every
// route's module graph so no validator on any route compiles a `Function`
// probe under the strict no-`unsafe-eval` CSP.
import '@/lib/zod-config';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Root layout — NOCTURNE shell.
 *
 * Fonts (Task 2.2): two OFL-licensed VARIABLE faces, self-hosted by next/font
 * (no runtime Google request — CSP-clean, no third-party `font-src`), chosen
 * DISTINCT from every sibling (apex: Inter + Space Grotesk; atlas: IBM Plex;
 * tape: Inter + JetBrains; pulse: Geist; razors-edge: Fraunces + Inter; atrium:
 * Bricolage + Inter):
 *   - Sora   → `--font-nocturne-display` (the NOCTURNE wordmark + preset/source
 *              labels). A geometric, slightly technological display cut with a
 *              real weight axis (100–800) — a precise, "instrument" register
 *              (Klim / Linear specimen direction). SIL OFL 1.1.
 *   - Outfit → `--font-nocturne-sans` (UI + body on /about). A clean geometric
 *              sans with a continuous weight axis (100–900). SIL OFL 1.1.
 * Both expose CSS variables bound on <html>; globals.css `--font-sans` /
 * `--font-display` reference them with a system fallback (next/font adds
 * `size-adjust` metrics so the fallback swap does not shift layout). Provenance
 * recorded in AGENT_NOTES.md.
 *
 * `<html>` carries `suppressHydrationWarning` because next-themes mutates the
 * class on the client before React hydrates (the documented next-themes
 * pattern). DARK is the canonical default, so the server renders the dark token
 * set from `:root` and there is no light flash.
 * --------------------------------------------------------------------- */

/**
 * Sora — variable display/technical sans for the NOCTURNE wordmark + labels.
 * SIL Open Font License 1.1.
 */
const nocturneDisplay = Sora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nocturne-display',
});

/**
 * Outfit — variable geometric sans for UI + body (the /about reading surface).
 * SIL Open Font License 1.1.
 */
const nocturneSans = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-nocturne-sans',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'generative art',
    'WebGL',
    'GPGPU',
    'particle system',
    'audio reactive',
    'curl noise',
    'creative coding',
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
  // The stage is always dark; the browser chrome colour tracks the dark stage
  // ground in both themes (the canvas never goes light — ADR-004 §4).
  themeColor: '#07080f',
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
      className={`${nocturneSans.variable} ${nocturneDisplay.variable}`}
    >
      <body className="antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-foreground)',
            }}
          >
            Skip to content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
