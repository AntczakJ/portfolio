import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Gauge,
  Radar,
  Radio,
  Route as RouteIcon,
  Server,
  Waypoints,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/chrome/theme-toggle';
import { StatusBadge } from '@/components/panels/status-badge';
import { JsonLd } from '@/components/seo/json-ld';
import { DEMO_CITY_NAME } from '@/lib/fleet/demo-city';
import { buildStaticSnapshot } from '@/lib/fleet/static-snapshot';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site-config';

/**
 * Landing / public read surface (Task 6.3) — the SEO-bearing, no-JS-floor page.
 *
 * A Server Component rendered ENTIRELY from static, deterministic content (the
 * pitch + a static fleet snapshot table + the route/zone reference) with NO
 * client-only data dependency: it server-renders identically every request,
 * scores Lighthouse from static HTML, and is meaningful with JavaScript
 * disabled. The live operations map (the wow) lives at `/` and honestly requires
 * JS (the WebSocket does) — this surface is the crawlable, fast, accessible
 * front door and the no-JS floor.
 *
 * It carries the full SEO surface: per-page metadata + canonical, an OG image
 * (the `/about/opengraph-image` route), and JSON-LD (WebApplication).
 */

export const metadata: Metadata = {
  title: 'Live fleet operations, built on a real-time spine',
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    url: '/about',
    title: `${SITE_NAME} — live fleet operations`,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
  },
};

const FEATURES = [
  {
    icon: Radio,
    title: 'Genuinely pushed telemetry',
    body: 'A single WebSocket carries authoritative fleet telemetry at a fixed cadence. No polling loop — open DevTools and watch one connection stream frames.',
  },
  {
    icon: Gauge,
    title: '1 Hz data, 60 fps motion',
    body: 'The server ticks once a second; the client interpolates between authoritative positions with requestAnimationFrame so markers glide along the road at 60 fps.',
  },
  {
    icon: Server,
    title: 'Server-authoritative simulation',
    body: 'A deterministic, seeded tick reducer advances the fleet along real routes. Positions, ETAs, route progress and geofence transitions are all computed server-side.',
  },
  {
    icon: Waypoints,
    title: 'Live geofence events',
    body: 'Zones are drawn as polygons; as a vehicle crosses a boundary an enter / exit event fires live — the zone pulses, the event lands, and the status flips.',
  },
] as const;

export default function AboutPage(): ReactNode {
  const snapshot = buildStaticSnapshot();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript and WebGL for the live map.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Person',
      name: 'Jan Antczak',
    },
  };

  return (
    <div className="bg-background text-foreground min-h-dvh">
      <JsonLd data={jsonLd} />

      {/* Header */}
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className="bg-accent-soft text-accent-ink flex size-7 items-center justify-center rounded-md"
              aria-hidden="true"
            >
              <Radar className="size-4" />
            </span>
            <span className="text-md font-semibold tracking-tight">{SITE_NAME}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="bg-accent text-accent-contrast focus-visible:ring-accent inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
            >
              Open the live map
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 py-12">
        {/* Hero / pitch */}
        <section className="mb-16">
          <p className="text-accent-ink mb-3 font-mono text-xs tracking-wider uppercase">
            Real-time spatial systems
          </p>
          <h1 className="text-foreground max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            A live operations map where the fleet moves smoothly in real time — and
            the world reacts as it moves.
          </h1>
          <p className="text-fg-muted mt-5 max-w-2xl text-base leading-relaxed">
            {SITE_NAME} is a server-authoritative fleet simulation streamed over a
            single WebSocket to a keyless map. Vehicles glide along real{' '}
            {DEMO_CITY_NAME} routes, ETAs tick down, route trails draw, and geofence
            events fire as vehicles cross zone boundaries. The smoothness is genuine
            client-side interpolation between authoritative ticks — not faked motion.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="bg-accent text-accent-contrast focus-visible:ring-accent inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
            >
              Open the live operations map
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <span className="text-fg-subtle text-xs">
              The live map requires JavaScript and WebGL. The fleet below renders
              without either.
            </span>
          </div>
        </section>

        {/* Feature grid */}
        <section className="mb-16">
          <h2 className="sr-only">How it works</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <li
                  key={f.title}
                  className="border-border bg-surface rounded-lg border p-5"
                >
                  <span
                    className="bg-accent-soft text-accent-ink mb-3 flex size-8 items-center justify-center rounded-md"
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <h3 className="text-foreground text-sm font-semibold">{f.title}</h3>
                  <p className="text-fg-muted mt-1.5 text-sm leading-relaxed">{f.body}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Static fleet snapshot — the no-JS floor's meaningful data. */}
        <section className="mb-16">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-foreground text-lg font-semibold tracking-tight">
              Fleet snapshot
            </h2>
            <span className="text-fg-subtle font-mono text-xs">
              {snapshot.vehicleCount} units · {DEMO_CITY_NAME}
            </span>
          </div>
          <p className="text-fg-muted mb-4 max-w-2xl text-sm leading-relaxed">
            A representative snapshot of the {DEMO_CITY_NAME} fleet, rendered server-side
            from the same seeded world the live engine runs. On the live map these
            positions update in real time.
          </p>
          <div className="border-border bg-surface overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Static fleet snapshot — unit, status, route, current zone, speed,
                  route progress and estimated time of arrival for each vehicle.
                </caption>
                <thead className="bg-surface-2 text-fg-muted text-2xs uppercase">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Unit</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                    <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">Route</th>
                    <th scope="col" className="hidden px-3 py-2 text-left font-medium md:table-cell">Zone</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Speed</th>
                    <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Progress</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.map((row) => (
                    <tr key={row.id} className="border-border border-t">
                      <td className="text-foreground px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} size="sm" />
                      </td>
                      <td className="text-fg-muted hidden px-3 py-2 sm:table-cell">{row.routeName}</td>
                      <td className="text-fg-muted hidden px-3 py-2 md:table-cell">{row.zoneName ?? '—'}</td>
                      <td className="text-fg-muted px-3 py-2 text-right font-mono text-xs tabular-nums">{row.speed}</td>
                      <td className="text-fg-muted hidden px-3 py-2 text-right font-mono text-xs tabular-nums sm:table-cell">{row.progressPct}%</td>
                      <td className="text-accent-ink px-3 py-2 text-right font-mono text-xs tabular-nums">{row.eta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Route + zone reference */}
        <section className="mb-16 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-foreground mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <RouteIcon className="text-fg-muted size-4" aria-hidden="true" />
              Routes
            </h2>
            <ul className="flex flex-col gap-2">
              {snapshot.routes.map((r) => (
                <li
                  key={r.id}
                  className="border-border bg-surface flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="text-foreground font-medium">{r.name}</span>
                  <span className="text-fg-muted font-mono text-xs">
                    {r.lengthKm} km · {r.stopCount} stops ·{' '}
                    {r.loopMode === 'loop' ? 'loop' : 'ping-pong'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-foreground mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Waypoints className="text-fg-muted size-4" aria-hidden="true" />
              Zones
            </h2>
            <ul className="flex flex-col gap-2">
              {snapshot.zones.map((z) => (
                <li
                  key={z.id}
                  className="border-border bg-surface flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="text-foreground font-medium">{z.name}</span>
                  <span className="text-fg-muted font-mono text-xs capitalize">
                    {z.kind.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="text-fg-subtle mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 px-5 py-6 text-xs sm:flex-row sm:items-center">
          <span>
            {SITE_NAME} — a portfolio showcase by Jan Antczak. Fastify · WebSocket ·
            MapLibre · a deterministic simulation engine.
          </span>
          <Link href="/" className="text-fg-muted hover:text-foreground underline">
            Open the live map
          </Link>
        </div>
      </footer>
    </div>
  );
}
