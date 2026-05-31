'use client';

import type { ReactNode } from 'react';

import { useApiHealth } from '@/lib/hooks/use-api-health';
import { cn } from '@/lib/cn';

/**
 * Minimal API health indicator. When the Elysia backend is not running
 * we render a calm offline dot rather than a red alarm — the landing
 * page is read by visitors who may not be the operator.
 *
 * Latency surfaces in the bottom status bar (`@/components/chrome/
 * status-bar`) — both consumers share the `useApiHealth` query via
 * TanStack Query deduplication, so there is exactly one poll on the
 * `/health` endpoint regardless of how many places in the tree render
 * a derived value.
 */
export function ApiStatus(): ReactNode {
  const { status } = useApiHealth();

  const label =
    status === 'online' ? 'API online' : status === 'pending' ? 'Checking API' : 'API offline';

  return (
    <div
      className="inline-flex items-center gap-2 font-mono text-xs text-(--color-fg-muted)"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'online' && 'bg-(--color-success)',
          status === 'pending' && 'bg-(--color-fg-subtle)',
          status === 'offline' && 'bg-(--color-fg-subtle)',
        )}
      />
      <span>{label}</span>
    </div>
  );
}
