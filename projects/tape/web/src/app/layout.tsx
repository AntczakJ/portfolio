import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ReplayBar } from '@/components/chrome/replay-bar';
import { SideRail } from '@/components/chrome/side-rail';
import { StatusBar } from '@/components/chrome/status-bar';
import { TopBar } from '@/components/chrome/top-bar';

import { Providers } from './providers';

import './globals.css';

/* -------------------------------------------------------------------------
 * Responsive breakpoints (per CLAUDE.md § 4 mobile-first 320 px upward).
 *
 *   ≥ 1024 px  desktop      top bar + rail (240 / 56 px) + main + replay bar + status bar
 *   768–1023   tablet       rail auto-collapses to icon-only on first mount;
 *                           Zustand-persisted user override (`tape-ui-v1`)
 *                           wins on subsequent visits
 *   < 768 px   mobile       rail hidden, top-bar PanelLeft button opens a
 *                           Motion slide-over (open-coded, no shadcn sheet)
 *   < 480 px   compact      symbol indicator collapses to short ticker
 *                           ("BTC-PERP"); status bar wraps to two rows
 *
 * Vertical stack (every viewport):
 *
 *   TopBar          h-12  (48 px)        fixed
 *   <flex row>      flex-1               grows
 *     SideRail      shrink-0 (md+)       240 / 56 px animated
 *     <main>        flex-1, min-w-0      hosts the Phase 3 chart canvas
 *   ReplayBar       shrink-0             16 px (live) / 56 px (replay), Motion height
 *   StatusBar       shrink-0             auto
 *
 * The replay bar is mounted unconditionally and toggles its expanded
 * size via Motion's height animation (same 220 ms easeOutCubic the rail
 * width uses, reduced-motion collapses to instant). The chart in Phase 3
 * reads its vertical real estate from the flex column above the bar, so
 * the height swap reshapes the canvas naturally without manual measure.
 * --------------------------------------------------------------------- */

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: {
    default: 'Tape',
    template: '%s — Tape',
  },
  description:
    'Real-time orderflow visualizer for crypto perpetual futures. Footprint, CVD, tape, replay.',
  applicationName: 'Tape',
  keywords: [
    'orderflow',
    'footprint chart',
    'CVD',
    'tape reading',
    'Binance Futures',
    'crypto perpetual',
  ],
  authors: [{ name: 'Jan Antczak' }],
  openGraph: {
    type: 'website',
    title: 'Tape',
    description:
      'Real-time orderflow visualizer for crypto perpetual futures.',
    siteName: 'Tape',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tape',
    description:
      'Real-time orderflow visualizer for crypto perpetual futures.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1c1f25' },
    { media: '(prefers-color-scheme: light)', color: '#f8f7f4' },
  ],
  width: 'device-width',
  initialScale: 1,
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          {/* TooltipProvider — required by Tooltip used in SideRail rail entries. */}
          <TooltipProvider delayDuration={150}>
            <div className="flex h-dvh min-h-dvh flex-col bg-(--color-bg) text-(--color-fg)">
              <TopBar />
              <div className="flex min-h-0 flex-1">
                {/* SideRail — collapsible primary navigation (md+). */}
                <SideRail />
                <main
                  id="main"
                  className="relative flex min-w-0 flex-1 overflow-hidden"
                  tabIndex={-1}
                >
                  {children}
                </main>
              </div>
              {/* ReplayBar — collapsed Live pill or expanded scrub/speed surface. */}
              <ReplayBar />
              <StatusBar />
            </div>
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
