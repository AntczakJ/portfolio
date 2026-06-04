'use client';

import { CheckCircle2Icon, RadioIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { PublicIncidentList } from './public-incident-list';
import { PublicMonitorRow } from './public-monitor-row';
import { StatusDot } from '@/components/dashboard/status-dot';
import { cn } from '@/lib/cn';
import {
  overallBanner,
  openIncidentCount,
} from '@/lib/public-status/public-status-view';
import { usePublicStatusLive } from '@/lib/sse/use-public-status-live';
import { useNow } from '@/lib/time/use-now';
import { formatRelativeTime } from '@/lib/time/relative-time';
import type { PublicStatusPage } from 'pulse-server';

/**
 * The public status page (Task 6.6) — the shareable, SEO artifact.
 *
 * SSRs from `GET /public/:slug` (passed as `initialData`), then live-updates
 * from the redacted public SSE stream (`usePublicStatusLive`): any
 * `status.change` / `incident.*` re-fetches the cheap snapshot, so the banner
 * and the rows reflect a live outage without a reload. The page is anonymous
 * and carries STRICTLY the redacted subset (status + uptime %, recent
 * incidents) — never raw response times, alert data, or private monitors.
 *
 * The calm, premium register is judged against Stripe / Linear (the brief):
 * a single confident status banner, a quiet monitor list with the uptime %, and
 * a recent-incident timeline. Light + dark, fully usable from 320 px (the
 * most-shared-to-mobile surface).
 */
export function PublicStatusView({
  slug,
  initialData,
}: {
  slug: string;
  initialData: PublicStatusPage;
}): ReactNode {
  const { data, connection } = usePublicStatusLive(slug, initialData);
  const now = useNow();

  const incidentCount = useMemo(() => openIncidentCount(data), [data]);
  const banner = overallBanner(data.overall, incidentCount);
  const generatedMs = Date.parse(data.generatedAt);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <OverallBanner banner={banner} />

      <section aria-label="Monitored services" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg-muted">Services</h2>
          <span className="text-xs text-fg-subtle">30-day uptime</span>
        </div>
        {data.monitors.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-fg-subtle">
            No public services are listed yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {data.monitors.map((monitor) => (
              <li key={monitor.id}>
                <PublicMonitorRow monitor={monitor} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <PublicIncidentList incidents={data.incidents} now={now} />

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5 text-xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block size-1.5 rounded-full',
              connection === 'live' ? 'bg-status-up' : 'bg-status-unknown',
            )}
            aria-hidden="true"
          />
          {connection === 'live' ? 'Live' : 'Reconnecting'} · updated{' '}
          {/*
            The relative "updated Ns ago" is intrinsically time-dependent: the
            server renders one `now`, the client hydrates with a freshly ticked
            `now`, so the text legitimately differs. suppressHydrationWarning on
            THIS node only tells React the divergence is expected (the React-
            sanctioned use for timestamps) — keeping the page hydration-clean
            without faking a match. The status/content around it still SSRs for
            SEO; only this one live string is exempt.
          */}
          <span className="tabular-nums" suppressHydrationWarning>
            {Number.isNaN(generatedMs)
              ? 'recently'
              : formatRelativeTime(generatedMs, now)}
          </span>
        </span>
        <span>Status by Pulse</span>
      </footer>
    </div>
  );
}

function OverallBanner({
  banner,
}: {
  banner: ReturnType<typeof overallBanner>;
}): ReactNode {
  const Icon =
    banner.tone === 'up'
      ? CheckCircle2Icon
      : banner.tone === 'degraded'
        ? RadioIcon
        : TriangleAlertIcon;

  const toneClasses = {
    up: 'border-status-up/30 bg-status-up-surface',
    degraded: 'border-status-degraded/35 bg-status-degraded-surface',
    down: 'border-status-down/35 bg-status-down-surface',
  } as const;

  const iconClasses = {
    up: 'text-status-up-text',
    degraded: 'text-status-degraded-text',
    down: 'text-status-down-text',
  } as const;

  return (
    <section
      aria-label="Overall status"
      className={cn(
        'flex items-center gap-4 rounded-xl border px-5 py-5 sm:px-6 sm:py-6',
        toneClasses[banner.tone],
      )}
    >
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full bg-bg/60 [&_svg]:size-6',
          iconClasses[banner.tone],
        )}
        aria-hidden="true"
      >
        <Icon />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground text-balance sm:text-xl">
          {banner.headline}
        </h1>
        {/* The accessible, non-color status label (never color-alone). */}
        <StatusDot status={banner.dotStatus} withLabel className="sr-only" />
        <p className="text-sm text-fg-muted">
          {banner.tone === 'up'
            ? 'All monitored services are responding normally.'
            : banner.tone === 'degraded'
              ? 'Some services are slow or partially impaired.'
              : 'One or more services are currently down.'}
        </p>
      </div>
    </section>
  );
}
