'use client';

import type { ReactNode } from 'react';

import { useApiHealth } from '@/lib/hooks/use-api-health';
import { cn } from '@/lib/cn';

/**
 * Subtle 6-px health-pip rendered next to the BrandMark in the TopBar.
 *
 * Phase 1 / Task 2.2 deliverable. Three visible states (idle and
 * loading share the neutral palette — the user does not need to
 * distinguish them, an inspecting recruiter sees the rest from the
 * Network tab):
 *
 *   - `ok`              --color-success, subtle calm-green "alive".
 *   - `idle`/`loading`  --color-fg-muted, neutral reading.
 *   - `error`           --color-error, alarms without shouting.
 *
 * The spec named `--color-bg-strong` for the ok state; that token
 * does not exist in the meld palette and the closest semantic match
 * is `--color-success` (a calm emerald sitting outside the violet
 * brand hue band so the dot reads as "operational" not "brand"). The
 * choice is documented at the call site rather than a token rename
 * because future agents skimming the chrome should see WHY this picks
 * green-not-violet without spelunking palette history.
 *
 * The chrome stays light-touch: this is an indicator, not a status
 * bar. The dot lives to the right of the BrandMark so a viewer's eye
 * scans Brand -> health -> CTAs in one left-to-right pass, and the
 * dot disappears under attention when the API is healthy (the goal).
 *
 * The aria-label verbalises the state for screen readers; the visible
 * pip carries no text and is `aria-hidden` to keep the wordmark next
 * to it as the single accessible name in the brand cluster. The label
 * lives on the wrapping span with `role="status"` so AT users hear the
 * state change without a visual cue.
 *
 * The TanStack Query key (`['api-health']`) is shared with the hook —
 * if Phase 3.3's connection-status pill or any future surface also
 * calls `useApiHealth`, TanStack dedupes the network request so there
 * is exactly one `/health` poll per visible page regardless of how
 * many places render a derived value.
 */
export function ApiStatusDot(): ReactNode {
  const { status } = useApiHealth();

  const label =
    status === 'ok'
      ? 'API connected'
      : status === 'error'
        ? 'API offline'
        : 'API checking';

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="api-status-dot"
      data-status={status}
      className="inline-flex items-center"
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full transition-colors duration-200',
          status === 'ok' && 'bg-(--color-success)',
          (status === 'idle' || status === 'loading') &&
            'bg-(--color-fg-muted)',
          status === 'error' && 'bg-(--color-error)',
        )}
      />
    </span>
  );
}
