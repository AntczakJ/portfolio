import type { ReactNode } from 'react';

import { ApiStatus } from '@/components/api-status';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandMark } from '@/components/chrome/brand-mark';
import { MobileRail } from '@/components/chrome/mobile-rail';
import { SymbolIndicator } from '@/components/chrome/symbol-indicator';

/**
 * Top application bar. Three slots: brand mark + mobile rail trigger on
 * the left, symbol indicator centred, ApiStatus + ThemeToggle on the
 * right. Server-rendered shell with three client islands (the rail
 * trigger and the two existing components from Task 2.1 / 2.2).
 */
export function TopBar(): ReactNode {
  return (
    <header
      role="banner"
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-(--color-border) bg-(--color-surface) px-3 md:px-4"
    >
      <div className="flex items-center gap-2">
        <MobileRail />
        <BrandMark />
      </div>
      <div className="min-w-0">
        <SymbolIndicator />
      </div>
      <div className="flex items-center gap-3">
        <ApiStatus />
        <ThemeToggle />
      </div>
    </header>
  );
}
