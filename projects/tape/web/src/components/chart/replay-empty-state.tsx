'use client';

/**
 * <ReplayEmptyState /> — calm overlay shown over the chart when replay
 * mode is active but the selected date has no persisted data (Task 3.6).
 *
 * The replay endpoint returns 200 + an empty NDJSON stream for a dataless
 * day (ADR-005 / Task 1.7 — "no cells yet" is a legitimate state, not an
 * error). This surfaces that as a centered note rather than an empty
 * chart that reads as broken. Only renders in `'replay'` mode with the
 * engine's `loadState === 'empty'`; in `'loading'` / `'ready'` it is
 * absent so the chart shows through.
 */
import type { ReactNode } from 'react';
import { CalendarOff } from 'lucide-react';

import { useUiStore } from '@/lib/stores/ui-store';
import { useReplayLoadState } from '@/lib/replay/replay-status-store';

export function ReplayEmptyState(): ReactNode {
  const replayMode = useUiStore((s) => s.replayMode);
  const replayDate = useUiStore((s) => s.replayDate);
  const loadState = useReplayLoadState();

  if (replayMode !== 'replay' || loadState !== 'empty') return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-(--color-bg)/40 backdrop-blur-[1px]"
      role="status"
    >
      <CalendarOff
        className="size-7 text-(--color-fg-subtle)"
        aria-hidden="true"
      />
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-(--color-fg-muted)">
        No replay data for this date
      </p>
      <p className="max-w-xs px-6 text-center font-mono text-[10px] leading-relaxed text-(--color-fg-subtle)">
        {`${replayDate} has no persisted footprint cells. Switch back to Live or pick a session day with recorded data.`}
      </p>
    </div>
  );
}
