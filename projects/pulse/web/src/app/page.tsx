import {
  ActivityIcon,
  ArrowRightIcon,
  BellIcon,
  GaugeIcon,
  RadioIcon,
  ShieldCheckIcon,
  ZapIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { BoardPreview } from '@/components/marketing/board-preview';
import { MarketingHeader } from '@/components/marketing/marketing-header';
import { StatusDot } from '@/components/dashboard/status-dot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

/**
 * Landing / marketing page (Task 6.7) — the front door.
 *
 * The dashboard + the live demo-incident arc ARE the wow; this page's job is to
 * communicate the product in five seconds and route the viewer into the open
 * demo. Clean-SaaS, judged against Linear (hierarchy, restraint) and Vercel
 * (deliberate accents, dense without busyness). Server component, no client
 * data dependency, so it stays SSR / static-friendly (the Lighthouse posture
 * the public surfaces hold). Light + dark.
 */
export default function HomePage(): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <MarketingHeader />
      <main id="main" className="flex-1">
        {/* Hero — lead with the copy, then SHOW the live board above the fold. */}
        <section className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 pt-12 pb-12 text-center sm:px-6 sm:pt-16 sm:pb-16">
          <Badge variant="muted" className="gap-1.5">
            <RadioIcon className="size-3" />
            Live status, pushed over SSE — not polled
          </Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Uptime monitoring that proves itself
          </h1>
          <p className="max-w-xl text-base text-fg-muted text-pretty sm:text-lg">
            Pulse runs real scheduled probes against your endpoints, streams the
            results to a live status board, opens and resolves incidents on its
            own, and ships a public status page your users can trust.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/dashboard">
                View the live demo
                <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`/status/${env.demoStatusSlug}`}>
                See an example status page
              </Link>
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <ShieldCheckIcon className="size-3.5" />
            The probes are real. History is seeded; everything from now is live.
          </p>

          {/* The board preview — the wow, shown not described (H-5). */}
          <div className="relative mt-4 w-full max-w-4xl">
            {/* A soft brand glow behind the figure to lift it off the page. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-8 -top-8 bottom-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,var(--color-brand-surface),transparent)] opacity-70"
            />
            <BoardPreview />
          </div>
        </section>

        {/* Feature trio — the systems the product is built around */}
        <section
          aria-label="What Pulse does"
          className="mx-auto max-w-5xl px-4 pb-16 sm:px-6"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Feature
              icon={ActivityIcon}
              title="A live board"
              detail="Real probes on their interval. The board updates over one SSE connection — a fresh response time, a sparkline point, a status pulse — no reload, no polling."
            />
            <Feature
              icon={ZapIcon}
              title="Self-managing incidents"
              detail="Consecutive failures open an incident; recoveries close it. The timeline writes itself, with degraded-vs-down severity and flap suppression."
            />
            <Feature
              icon={BellIcon}
              title="Alerts + a status page"
              detail="A signed webhook fires on every transition. A clean, shareable public status page ships the artifact a real uptime product ships."
            />
          </div>
        </section>

        {/* The wow callout — point straight at the demo-incident arc */}
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <div className="flex flex-col items-start gap-4 rounded-xl border border-brand/25 bg-brand-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex max-w-xl flex-col gap-1.5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <GaugeIcon className="size-5 text-brand" />
                Watch an incident open live
              </h2>
              <p className="text-sm text-fg-muted text-pretty">
                One click arms a real failing endpoint. In ~30 seconds the board
                flips a service down, an incident opens and counts up, an alert
                fires, and on recovery it auto-closes. No mock — the real
                pipeline, on demand.
              </p>
            </div>
            <Button asChild size="lg" className="shrink-0">
              <Link href="/dashboard">
                Trigger it yourself
                <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </section>

        {/* Status legend */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-sm font-medium text-fg-muted">
                Status legend
              </h2>
              <span className="text-xs text-fg-subtle">
                Color is never the only signal
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <LegendItem status="up" detail="Healthy and fast" />
              <LegendItem status="degraded" detail="Up but slow" />
              <LegendItem status="down" detail="Failing checks" />
              <LegendItem status="unknown" detail="No recent data" />
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-fg-subtle sm:flex-row sm:px-6">
          <span>Pulse — a portfolio showcase by Jan Antczak.</span>
          <span>Built with Next.js, NestJS, BullMQ, and SSE.</span>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof ActivityIcon;
  title: string;
  detail: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <span
        className="flex size-9 items-center justify-center rounded-md bg-brand-surface text-brand [&_svg]:size-4.5"
        aria-hidden="true"
      >
        <Icon />
      </span>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-fg-muted text-pretty">{detail}</p>
    </div>
  );
}

function LegendItem({
  status,
  detail,
}: {
  status: 'up' | 'degraded' | 'down' | 'unknown';
  detail: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <StatusDot status={status} withLabel />
      <span className="pl-[1.125rem] text-xs text-fg-subtle">{detail}</span>
    </div>
  );
}
