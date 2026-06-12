import { GITHUB_BASE } from '@/lib/site-config';
import {
  projectsSchema,
  type Project,
  type ProjectSlug,
} from '@/lib/schemas/project';

/**
 * The single typed source of truth for the six showcase projects (ADR-001 /
 * ADR-003). Six fixed, hand-authored entries — read at build time, Zod-validated
 * at module load (a malformed entry fails the build, not the UI). The web-only
 * thesis: there is nothing to fetch and nothing to administer.
 *
 * Sourcing:
 *   - `pitch` and `stack` are sourced verbatim-faithfully from the root
 *     `README.md` project table (the deliberate single source of truth). The
 *     `stack` here is a curated subset of the README "Stack" string — the chips
 *     the bay shows — not the full string.
 *   - `demoUrl` is the real public Fly URL, linked NORMALLY (the internal "Fly
 *     stopped to control cost" status is NEVER surfaced — auto-start on URL hit
 *     covers the viewer).
 *   - `repoUrl` is DERIVED from the single `GITHUB_BASE` seam (R1 monorepo
 *     deep-link `${GITHUB_BASE}/tree/main/projects/<slug>`). There is ZERO inline
 *     hardcoded `github.com/...` string anywhere — flip `GITHUB_BASE` (one env
 *     var) and all six links become real. While the placeholder is in force the
 *     bay renders the U2 disabled affordance (gated on `REPO_LINKS_LIVE`), never
 *     navigating to the placeholder.
 *   - `wowMoment` is authored from each project's own five-second hook.
 *   - `previewImage` is the bay's PREVIEW STILL key (the atrium v2 enrichment,
 *     the long-reserved Task 4.5). It is the project SLUG; the bay's
 *     `PreviewStill` component resolves it to a theme-matched dark+light AVIF
 *     pair (static-imported from `src/assets/preview-stills/<slug>-{dark,light}.avif`,
 *     so the stills emit into `.next/static` and atrium needs NO `public/` dir).
 *     Each still is the portfolio's OWN committed screenshot of that project,
 *     cropped + optimised by `scripts/optimize-preview-stills.mjs` (provenance in
 *     that script + `docs/preview-stills-shots/`). The still is NEVER the LCP and
 *     is lazy-loaded (the hero wordmark stays the LCP).
 *   - `year` is a fixed field (determinism — no `Date.now()`).
 */

/** R1 monorepo deep-link shape (ADR-003). The single repo-URL derivation. */
function repoUrlFor(slug: ProjectSlug): string {
  return `${GITHUB_BASE}/tree/main/projects/${slug}`;
}

// Raw literal — validated below. Typed loosely as the input so the schema is the
// only thing asserting shape (a deliberate mistake would fail `parse`, not slip
// past a hand-written type).
const rawProjects = [
  {
    slug: 'tape',
    name: 'tape',
    tagline: 'Real-time orderflow terminal',
    pitch:
      'Production-grade real-time orderflow visualizer for crypto perpetual futures: a live Canvas2D footprint chart, CVD pane, tape strip, and replay, with a Rust hot-path aggregation worker behind a MessagePack bridge.',
    category: 'api-heavy',
    backend: 'Elysia (Bun)',
    stack: [
      'Next 15',
      'React 19',
      'Tailwind v4',
      'Elysia (Bun)',
      'Rust worker',
      'Postgres',
      'Drizzle',
    ],
    accentToken: '--bay-tape',
    wowMoment:
      'A live Canvas2D footprint chart redrawing the order book in real time, fed by a Rust aggregation worker over MessagePack.',
    demoUrl: 'https://tape-demo.fly.dev',
    repoUrl: repoUrlFor('tape'),
    previewImage: 'tape',
    year: 2026,
  },
  {
    slug: 'meld',
    name: 'meld',
    tagline: 'Local-first collaborative whiteboard',
    pitch:
      'Local-first collaborative whiteboard with sub-100 ms presence and CRDT auto-merge on reconnect.',
    category: 'api-heavy',
    backend: 'Hono (Node)',
    stack: [
      'Next 15',
      'React 19',
      'Tailwind v4',
      'Hono (Node 22)',
      'Hocuspocus',
      'Yjs',
      'Postgres',
      'Drizzle',
    ],
    accentToken: '--bay-meld',
    wowMoment:
      'Sub-100 ms multi-user presence, with CRDT auto-merge silently reconciling every edit made offline the instant a peer reconnects.',
    demoUrl: 'https://meld-demo.fly.dev',
    repoUrl: repoUrlFor('meld'),
    previewImage: 'meld',
    year: 2026,
  },
  {
    slug: 'razors-edge',
    name: "razor's edge",
    tagline: 'Cinematic dark-luxe barbershop',
    pitch:
      'Cinematic dark-luxe barbershop marketing site with a scroll-driven blade-sweep hero and a fully mocked multi-step booking flow.',
    category: 'web-only',
    backend: null,
    stack: [
      'Next 15',
      'React 19',
      'Tailwind v4',
      'GSAP (scroll)',
      'Motion (wizard)',
      'TanStack Query',
      'Zod',
    ],
    accentToken: '--bay-razors-edge',
    wowMoment:
      'A scroll-driven straight-razor blade sweeps across the wordmark and slices it open to reveal the portrait beneath.',
    demoUrl: 'https://razors-edge-demo.fly.dev',
    repoUrl: repoUrlFor('razors-edge'),
    previewImage: 'razors-edge',
    year: 2026,
  },
  {
    slug: 'pulse',
    name: 'pulse',
    tagline: 'Self-driving uptime monitor',
    pitch:
      'Real uptime monitor: scheduled probes, an SSE-pushed live status board, a self-driving incident state machine, signed webhook alerts, and a public redacted status page.',
    category: 'api-heavy',
    backend: 'NestJS',
    stack: [
      'Next 15',
      'React 19',
      'Tailwind v4',
      'uPlot',
      'NestJS (Node 22)',
      'BullMQ',
      'Redis',
      'Postgres',
      'Drizzle',
    ],
    accentToken: '--bay-pulse',
    wowMoment:
      'A self-driving incident state machine that opens, escalates, and resolves incidents on its own, pushed live to the status board over SSE.',
    demoUrl: 'https://pulse-demo-web.fly.dev',
    repoUrl: repoUrlFor('pulse'),
    previewImage: 'pulse',
    year: 2026,
  },
  {
    slug: 'apex',
    name: 'apex',
    tagline: 'WebGL car configurator',
    pitch:
      'Premium car-rental marketing site with a real WebGL 3D car configurator (live colour + wheel swaps, four-tier degradation) and a fully mocked multi-step reservation flow.',
    category: 'web-only',
    backend: null,
    stack: [
      'Next 15',
      'React 19',
      'Tailwind v4',
      'React Three Fiber',
      'drei',
      'GSAP (scroll)',
      'Zustand',
      'Zod',
    ],
    accentToken: '--bay-apex',
    wowMoment:
      'A genuine WebGL 3D car configurator with live colour and wheel swaps, degrading cleanly across four hardware tiers.',
    demoUrl: 'https://apex-rentals.fly.dev',
    repoUrl: repoUrlFor('apex'),
    previewImage: 'apex',
    year: 2026,
  },
  {
    slug: 'atlas',
    name: 'atlas',
    tagline: 'Live geospatial fleet control room',
    pitch:
      'Live geospatial fleet tracking: a server-side deterministic simulation streams fleet telemetry over one WebSocket to a MapLibre control-room map that glides the vehicles at 60 fps between 1 Hz ticks, with live ETAs and geofence events.',
    category: 'api-heavy',
    backend: 'Fastify',
    stack: [
      'Next 15',
      'React 19',
      'Tailwind v4',
      'MapLibre',
      'Fastify (Node 22)',
      '@fastify/websocket',
      'turf',
      'Postgres',
      'Drizzle',
    ],
    accentToken: '--bay-atlas',
    wowMoment:
      'A MapLibre control-room map gliding the whole fleet at 60 fps between 1 Hz telemetry ticks, with live ETAs and geofence events.',
    demoUrl: 'https://atlas-ops.fly.dev',
    repoUrl: repoUrlFor('atlas'),
    previewImage: 'atlas',
    year: 2026,
  },
];

/**
 * The validated, ordered collection. `projectsSchema` asserts exactly six
 * entries in canonical order, each well-formed (valid demo URL, backend agreeing
 * with category, accent token matching slug). A failure here is a BUILD failure.
 */
export const PROJECTS: readonly Project[] = projectsSchema.parse(rawProjects);
