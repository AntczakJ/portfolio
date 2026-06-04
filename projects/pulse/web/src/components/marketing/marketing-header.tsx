import Link from 'next/link';
import type { ReactNode } from 'react';

import { SessionMenu } from '@/components/auth/session-menu';
import { BrandMark } from '@/components/chrome/brand-mark';
import { ThemeToggle } from '@/components/chrome/theme-toggle';
import { Button } from '@/components/ui/button';

/**
 * Marketing header — the public-surface chrome (landing + the public status
 * page). Distinct from the dashboard chrome: no rail, a centred max-width
 * container, a "View live demo" entry into the open dashboard, and the
 * session-aware account affordance (sign in / your account).
 */
export function MarketingHeader(): ReactNode {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center" aria-label="Pulse home">
          <BrandMark />
        </Link>
        <nav
          aria-label="Primary"
          className="ml-auto flex items-center gap-1 sm:gap-2"
        >
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Live demo</Link>
          </Button>
          <ThemeToggle />
          <SessionMenu />
        </nav>
      </div>
    </header>
  );
}
