'use client';

import type { ReactNode } from 'react';

import { WorkerStatus } from '@/components/chrome/worker-status';
import { useApiHealth } from '@/lib/hooks/use-api-health';
import {
  useConnectionState,
  useLastTick,
  useTickCount,
} from '@/lib/stores/stream-store';

/**
 * Bottom status bar. Four cells, each a semantic `<dl><dt><dd>` so
 * screen readers announce them as labelled metrics.
 *
 * Cells:
 *  - **API latency**       — `useApiHealth` round-trip (HTTP `/health`).
 *  - **WS connection**     — `useConnectionState` from `useStreamStore`,
 *                            rendered as a small colored pip + status
 *                            label. `connected` = bid green,
 *                            `reconnecting` = warning amber,
 *                            `idle`/`connecting` = neutral.
 *  - **Tick count**        — `useTickCount`, formatted with thousands
 *                            separators (en-US).
 *  - **WS tick latency**   — derived from `useLastTick`: time since
 *                            the most recent tick in seconds, or
 *                            `'stale'` if > 5 s. Kept as a separate
 *                            cell from the API latency — the two are
 *                            different signals (HTTP probe vs stream
 *                            freshness) and merging them would lie.
 *
 * Typography is fixed-width so live values do not reflow the bar.
 *
 * Wraps to two rows below 480 px so the smallest viewport stays
 * legible.
 */
const TICK_STALE_MS = 5_000;

const TICK_COUNT_FORMATTER = new Intl.NumberFormat('en-US');

export function StatusBar(): ReactNode {
  const { status, latencyMs } = useApiHealth();
  const wsState = useConnectionState();
  const tickCount = useTickCount();
  const lastTickTsMs = useLastTick();

  const latencyLabel =
    status === 'pending' || latencyMs === null ? '—' : `${latencyMs} ms`;
  const tickLabel = TICK_COUNT_FORMATTER.format(tickCount);
  const tickLatencyLabel = renderTickLatency(lastTickTsMs);

  return (
    <footer
      role="contentinfo"
      className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-t border-(--color-border) bg-(--color-surface) px-3 py-2 font-mono text-[11px] text-(--color-fg-muted) md:px-4"
      data-numeric
    >
      <StatusCell label="API" value={latencyLabel} />
      <WsStatusCell state={wsState} />
      <StatusCell label="Ticks" value={tickLabel} />
      <StatusCell label="Last tick" value={tickLatencyLabel} />
      {/* Worker-offline indicator (ADR-004). Renders only while the Rust
          aggregation worker is restarting; sits next to the WS state so
          the two stream-health signals read together. */}
      <WorkerStatus />
      <span className="ml-auto text-(--color-fg-subtle)">Jan Antczak / 2026</span>
    </footer>
  );
}

interface StatusCellProps {
  label: string;
  value: string;
}

function StatusCell({ label, value }: StatusCellProps): ReactNode {
  return (
    <dl className="inline-flex items-baseline gap-1.5">
      <dt className="text-(--color-fg-subtle)">{label}</dt>
      <dd className="min-w-[3rem] text-(--color-fg)">{value}</dd>
    </dl>
  );
}

interface WsStatusCellProps {
  state: ReturnType<typeof useConnectionState>;
}

function WsStatusCell({ state }: WsStatusCellProps): ReactNode {
  const pipColor =
    state === 'connected'
      ? 'bg-(--color-bid)'
      : state === 'reconnecting'
        ? 'bg-(--color-warning)'
        : 'bg-(--color-fg-subtle)';
  const labelText =
    state === 'connected'
      ? 'connected'
      : state === 'reconnecting'
        ? 'reconnecting'
        : state === 'connecting'
          ? 'connecting'
          : 'idle';
  return (
    <dl className="inline-flex items-baseline gap-1.5">
      <dt className="text-(--color-fg-subtle)">WS</dt>
      <dd
        className="inline-flex min-w-[6rem] items-center gap-1.5 text-(--color-fg)"
        aria-live="polite"
      >
        <span
          className={`size-1.5 rounded-full ${pipColor}`}
          aria-hidden="true"
        />
        {labelText}
      </dd>
    </dl>
  );
}

function renderTickLatency(lastTickTsMs: number | null): string {
  if (lastTickTsMs === null) return '—';
  const elapsed = Date.now() - lastTickTsMs;
  if (elapsed < 0) return '0 s';
  if (elapsed >= TICK_STALE_MS) return 'stale';
  return `${(elapsed / 1000).toFixed(1)} s`;
}
