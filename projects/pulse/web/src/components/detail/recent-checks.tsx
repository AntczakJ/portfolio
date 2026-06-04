'use client';

import type { ReactNode } from 'react';

import { StatusDot } from '@/components/dashboard/status-dot';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/time/relative-time';
import { useNow } from '@/lib/time/use-now';
import type { CheckErrorClass, RecentCheck } from 'pulse-server';

interface RecentChecksProps {
  checks: readonly RecentCheck[] | undefined;
  loading: boolean;
}

const ERROR_LABEL: Record<CheckErrorClass, string> = {
  timeout: 'Timeout',
  dns: 'DNS',
  connection_refused: 'Refused',
  tls: 'TLS',
  ssrf_blocked: 'Blocked',
  http_error: 'HTTP',
  keyword_missing: 'No keyword',
  unknown: 'Error',
};

/**
 * The recent-checks list — the latest probe results (status dot + label, HTTP
 * code, response time in mono, error class, relative time). A clean table-like
 * list, the activity log under the chart.
 *
 * Each row pairs the status with the AA `StatusDot` (never color-only); the
 * response time and code use the mono / tabular-nums idiom so the column reads
 * as a precise log. The relative time ticks off the shared 1-second clock.
 */
export function RecentChecks({
  checks,
  loading,
}: RecentChecksProps): ReactNode {
  const now = useNow();

  if (loading) {
    return (
      <div className="flex flex-col gap-px">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded bg-surface" />
        ))}
      </div>
    );
  }

  if (!checks || checks.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-fg-subtle">
        No checks recorded yet. Results appear here as Pulse probes the endpoint.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {checks.map((check) => (
        <li
          key={check.id}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5"
        >
          <StatusDot status={check.status} />

          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-mono tabular-nums text-foreground">
              {check.responseTimeMs != null
                ? `${String(check.responseTimeMs)}ms`
                : '—'}
            </span>
            {check.statusCode != null ? (
              <span
                className={cn(
                  'font-mono text-xs tabular-nums',
                  codeClass(check.statusCode),
                )}
              >
                {check.statusCode}
              </span>
            ) : null}
            {check.error ? (
              <span className="rounded border border-status-down/30 bg-status-down-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-status-down-text">
                {ERROR_LABEL[check.error]}
              </span>
            ) : null}
          </div>

          <time
            dateTime={check.checkedAt}
            className="font-mono text-xs tabular-nums text-fg-subtle"
          >
            {formatRelativeTime(Date.parse(check.checkedAt), now)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** Color the HTTP code by class (2xx neutral, 4xx degraded, 5xx down). */
function codeClass(code: number): string {
  if (code >= 500) return 'text-status-down-text';
  if (code >= 400) return 'text-status-degraded-text';
  return 'text-fg-subtle';
}
