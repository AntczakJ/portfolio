'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { SessionMenu } from '@/components/auth/session-menu';
import { BrandMark } from '@/components/chrome/brand-mark';
import { ThemeToggle } from '@/components/chrome/theme-toggle';

/**
 * Dashboard top bar — the persistent header of the authenticated dashboard
 * chrome.
 *
 * The title + subtitle are path-aware so the header names the current section
 * (Monitors / Incidents / Alerts). The primary "New monitor" CTA + the
 * live-connection indicator live INSIDE the board header (`StatusBoard`), next
 * to the live data they act on. On narrow viewports the brand mark appears here
 * because the sidebar is hidden below `lg`.
 */
export function DashboardTopBar(): ReactNode {
  const pathname = usePathname();
  const { title, subtitle } = sectionFor(pathname);

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border bg-bg/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/60 sm:px-6">
      <div className="lg:hidden">
        <BrandMark withWordmark={false} />
      </div>
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-sm font-semibold text-foreground">
          {title}
        </h1>
        <p className="hidden text-xs text-fg-subtle sm:block">{subtitle}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <SessionMenu />
      </div>
    </header>
  );
}

function sectionFor(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith('/dashboard/incidents')) {
    return { title: 'Incidents', subtitle: 'Open and resolved, newest first' };
  }
  if (pathname.startsWith('/dashboard/alerts')) {
    return { title: 'Alerts', subtitle: 'Webhook and email channels' };
  }
  if (pathname.startsWith('/dashboard/monitors')) {
    return { title: 'Monitor', subtitle: 'Uptime, response time, history' };
  }
  return { title: 'Monitors', subtitle: 'Live status board' };
}
