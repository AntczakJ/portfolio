import type { ReactNode } from 'react';

import { DemoModeBanner } from '@/components/auth/demo-mode-banner';
import { DashboardNav } from '@/components/dashboard/dashboard-nav';
import { DashboardTopBar } from '@/components/dashboard/dashboard-top-bar';

/**
 * Dashboard segment layout — the authenticated chrome.
 *
 * A left rail (hidden below `lg`) + a sticky top bar + the scrollable
 * content region. The auth guard (better-auth session) that protects this
 * segment lands in Phase 6; for the scaffold the chrome renders openly so
 * the shell and tokens are reviewable.
 *
 * NOTE the deliberate two-shell split: the marketing / public surfaces use
 * `MarketingHeader` (centred, no rail), the dashboard uses this rail. They
 * are different products to two different audiences (PLAN.md), so they do
 * not share one global chrome.
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <DashboardNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar />
        <main id="main" className="flex-1 overflow-y-auto p-4 sm:p-6">
          <DemoModeBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
