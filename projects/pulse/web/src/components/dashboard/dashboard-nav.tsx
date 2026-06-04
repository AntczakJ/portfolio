'use client';

import {
  ActivityIcon,
  ArrowUpRightIcon,
  BellIcon,
  GlobeIcon,
  LayoutDashboardIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, ReactNode } from 'react';

import { BrandMark } from '@/components/chrome/brand-mark';
import { cn } from '@/lib/cn';
import { env } from '@/lib/env';
import { useLiveBoard } from '@/lib/store/live-store';

interface NavItem {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly href: string;
  /** External / cross-shell target (opens the public surface, not a dashboard
   * segment) — rendered as a plain link, the active-state matcher skips it. */
  readonly external?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Monitors', icon: LayoutDashboardIcon, href: '/dashboard' },
  { label: 'Incidents', icon: ActivityIcon, href: '/dashboard/incidents' },
  { label: 'Alerts', icon: BellIcon, href: '/dashboard/alerts' },
  {
    // L-2 — the Status page item now opens the real public status page (the
    // SEO artifact already shipped); no "SOON" on a feature-complete product.
    label: 'Status page',
    icon: GlobeIcon,
    href: `/status/${env.demoStatusSlug}`,
    external: true,
  },
];

/**
 * Dashboard sidebar — the clean-SaaS left rail (the Linear / Vercel dashboard
 * idiom). Path-aware: the active item is derived from `usePathname()`, so the
 * highlight follows real navigation across the Monitors / Incidents / Alerts
 * routes. The Status page item opens the live public status page (the shipped
 * SEO artifact); there are no "coming soon" placeholders on the rail.
 *
 * The Incidents item carries a live count of monitors with an open incident
 * (from the SSE store) as a small badge, so the rail reflects an active outage
 * the moment one opens — the wow-moment "something is happening" signal.
 *
 * Hidden below `lg`; the dashboard top bar carries the brand on narrow
 * viewports (the board reflows to a single column there).
 */
export function DashboardNav(): ReactNode {
  const pathname = usePathname();
  const openIncidentCount = useLiveBoard((s) =>
    Object.values(s.monitors).filter((m) => m.hasOpenIncident).length,
  );

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-14 items-center px-5">
        <BrandMark />
      </div>
      <nav
        aria-label="Dashboard"
        className="flex flex-1 flex-col gap-0.5 px-3 py-2"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = !item.external && isActive(pathname, item.href);
          const showIncidentBadge =
            item.href === '/dashboard/incidents' && openIncidentCount > 0;

          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-surface text-brand'
                  : 'text-fg-muted hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
              {showIncidentBadge ? (
                <span
                  className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-status-down px-1.5 text-[11px] font-semibold text-white tabular-nums"
                  aria-label={`${String(openIncidentCount)} open ${
                    openIncidentCount === 1 ? 'incident' : 'incidents'
                  }`}
                >
                  {openIncidentCount}
                </span>
              ) : item.external ? (
                <ArrowUpRightIcon
                  className="ml-auto size-3.5 text-fg-subtle/60"
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between border-t border-border px-5 py-4 text-xs text-fg-subtle">
        <span className="font-medium text-fg-muted">Pulse</span>
        <span className="font-mono tabular-nums text-fg-subtle/70">v1.0</span>
      </div>
    </aside>
  );
}

/** The Monitors root matches `/dashboard` exactly (and its monitor detail
 * subroutes); the others match their own path prefix. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname.startsWith('/dashboard/monitors');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
