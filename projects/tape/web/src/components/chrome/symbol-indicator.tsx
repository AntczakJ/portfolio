import type { ReactNode } from 'react';

import { Activity } from 'lucide-react';

/**
 * Current symbol indicator. Hard-coded to BTCUSDT-PERP in v1 per PLAN.md
 * (multi-symbol deferred to v2). At < 480 px the long form collapses to
 * a short ticker so the top bar stays single-row down to 320 px.
 *
 * Server Component — no interactivity until the symbol picker lands in
 * v2.
 */
export function SymbolIndicator(): ReactNode {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 font-mono text-xs text-(--color-fg)"
      data-numeric
    >
      <Activity
        aria-hidden="true"
        className="size-3.5 text-(--color-accent)"
      />
      <span className="max-[479px]:hidden">BTCUSDT-PERP</span>
      <span className="min-[480px]:hidden">BTC-PERP</span>
    </div>
  );
}
