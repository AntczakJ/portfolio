import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { StatusRow } from '@/components/chrome/status-row';
import { TopBar } from '@/components/chrome/top-bar';
import { getInitialIdentity } from '@/lib/api/session';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Layout shell — Task 2.3.
 *
 * Three persistent regions, every route gets them:
 *
 *   TopBar                  brand + New board CTA + theme toggle.
 *   { children } main       board canvas in Phase 2.5; placeholder in v1.
 *   StatusRow               muted helpline + attribution. Hidden < 640 px.
 *
 * NO left rail. Tape's chrome (the trader-terminal sibling project)
 * uses a SideRail as workspace-nav because tape has many workspaces.
 * Meld is single-board-per-URL — a rail would imply a multi-workspace
 * surface the product does not have, and would steal horizontal space
 * the canvas needs. The departure is deliberate; do not add one on
 * review without a redesign of the URL model.
 *
 * Breakpoints (CLAUDE.md § 4 mobile-first, validated from 320 px):
 *   320 px         brand + compact New board CTA + theme toggle. StatusRow hidden.
 *   640 px (sm)    full "New board" label appears. StatusRow renders.
 *   768 px (md)    same as 640 px. Canvas-edit threshold (Phase 2.6 enforces view-only below).
 *   1024 px (lg)   same layout; canvas placeholder card stays centered.
 *   1440 px+       canvas placeholder centered in a max-w container.
 *
 * Touch users (< 768 px in v1) get a degraded experience by design:
 * meld requires a pointer for the drawing surface. The chrome here
 * does not enforce that yet — Phase 2.6 will — but the responsive
 * layout assumes Phase 2.6's eventual constraint when deciding what
 * to keep visible at the smallest sizes.
 * --------------------------------------------------------------------- */

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: {
    default: 'Meld',
    template: '%s — Meld',
  },
  description:
    'Local-first collaborative whiteboard with sub-100 ms presence and conflict-free merges.',
  applicationName: 'Meld',
  keywords: [
    'collaborative whiteboard',
    'local-first',
    'CRDT',
    'Yjs',
    'real-time',
    'presence',
  ],
  authors: [{ name: 'Jan Antczak' }],
  openGraph: {
    type: 'website',
    title: 'Meld',
    description:
      'Local-first collaborative whiteboard with sub-100 ms presence and conflict-free merges.',
    siteName: 'Meld',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Meld',
    description:
      'Local-first collaborative whiteboard with sub-100 ms presence and conflict-free merges.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
    { media: '(prefers-color-scheme: dark)', color: '#221d2e' },
  ],
  width: 'device-width',
  initialScale: 1,
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({
  children,
}: RootLayoutProps): Promise<ReactNode> {
  // Task 2.5b — server-fetch the anonymous-session identity for the
  // brand-corner badge. The cookie is forwarded inside
  // `getInitialIdentity()` so the same `meld_session` cookie that
  // drives the WS welcome frame also drives the SSR identity. On API
  // error (server down) the result is `null` and the badge renders
  // its anonymous fallback — the chrome stays whole.
  const initialIdentity = await getInitialIdentity();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <div className="flex min-h-dvh flex-col bg-(--color-bg) text-(--color-fg)">
            <TopBar initialIdentity={initialIdentity} />
            {children}
            <StatusRow />
          </div>
        </Providers>
      </body>
    </html>
  );
}
