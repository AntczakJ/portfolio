# atlas — Architecture Decision Records

Append-only. New entries are added by the `architect` subagent during the implement phase. The initial entry below is authored by the `planner`.

---

## ADR-001: Stack flavour, backend, real-time transport, map engine + keyless tiles, geo-math/persistence posture, simulation-engine shape, and animation

**Status:** accepted
**Date:** 2026-06-06

### Context

`atlas` is a live geospatial fleet / delivery tracking product — slot 6 in the portfolio. A server-side, deterministic simulation moves a fleet of vehicles along predefined routes in real time; their telemetry streams over WebSocket to a live MapLibre map that feels alive: markers glide smoothly between authoritative server ticks (client-side `requestAnimationFrame` interpolation), route trails draw, live ETAs tick down, and geofence enter/exit events fire live. The map is the centerpiece and is judged on "does it feel alive and real?"

The audience is dual: (1) a senior fullstack / backend recruiter or engineer who must read "this person can build real-time spatial systems — a simulation engine, a telemetry stream, server-side geo domain logic" in the first 10 seconds, often confirming in DevTools that the live channel is a genuine WebSocket carrying telemetry, not a polling loop; and (2) an operations-minded evaluator who exercises the fleet list, vehicle focus/detail, ETA panel, and events feed, including on mobile. The wow serves viewer 1: a map where the fleet moves smoothly in real time (1 Hz authoritative data, 60 fps interpolated motion) and the world reacts as vehicles cross geofence boundaries.

The owner has fixed the major stack inputs in the brief: **api-heavy, Fastify (Node 22), `@fastify/websocket`, MapLibre GL JS with a keyless-by-default tile source, a server-side deterministic simulation engine, turf.js for geo math, Drizzle + Postgres, Zod, sovereign operations/control-room tokens, Motion only for UI/panel transitions (the map is the wow).** ADR-001 ratifies those against `docs/conventions.md`, names the load-bearing constraints (keyless map; the streaming/interpolation surface is not Motion), and scopes the six deeper designs deferred to the architect.

Portfolio-composition context (root `PROGRESS.md` § tracker): tape (slot 1) = **Elysia on Bun**; meld (slot 2) = **Hono on Node**; razors-edge (slot 3) = web-only; pulse (slot 4) = **NestJS on Node**; apex (slot 5) = web-only. The § 12 backend-variance target (2–3 api-heavy, ≥ 2 backends, ideally three) was already satisfied with margin by pulse (three api-heavy across three backends). **Fastify is the one § 11 backend not yet exercised.** Atlas claims it deliberately, taking the portfolio to **four api-heavy projects across four distinct backends (Elysia/Bun · Hono/Node · NestJS · Fastify)** — every § 11 framework now represented and the backend-variance story **complete**.

### Options considered

**Web-only vs api-heavy:**

- **A. web-only (Next route handlers + server actions).** Rejected by the hard criteria — **three** of the five `docs/conventions.md` § 10 api-heavy triggers fire: a long-lived high-frequency WebSocket telemetry stream, a continuously-running background simulation loop independent of any HTTP request, and heavy geospatial domain logic (route projection, ETA, geofence transition detection) worth isolating from the UI. Any one is sufficient; the simulation loop alone forecloses web-only.
- **B. api-heavy.** Forced by A's rejection. **Picked.**

**Backend framework (assuming api-heavy):**

- **B1. Fastify on Node 22.** Mature, fast, plugin-first. Atlas's server is a focused, performance-sensitive surface — a WS endpoint fanning high-frequency telemetry, a continuous engine loop, a small REST/read surface, the geo logic — which is exactly Fastify's sweet spot: `@fastify/websocket` is a first-class WS plugin (built on `ws`), `fastify-type-provider-zod` pairs schema-first routing with the shared Zod contract, and the plugin/encapsulation model keeps the engine, the WS gateway, the geo services, and the REST routes as clean separately-testable units without decorator/DI ceremony. Low request-path overhead matters on the WS broadcast hot path. **It is also the one § 11 backend not yet used.** **Picked.**
- **B2. NestJS on Node.** Already committed by pulse (slot 4); reusing it collapses variance. Also over-structured for Atlas's smaller, performance-shaped surface — the module/DI/decorator ceremony that earned its keep on pulse's eight-module surface would be overhead here. Rejected.
- **B3. Hono on Node.** Already committed by meld (slot 2). Same composition rejection. (Hono is a fine WS host, but variance forbids the repeat.) Rejected.
- **B4. Elysia on Bun.** Already committed by tape (slot 1). Same composition rejection; also the geo/Drizzle/`ws` ecosystem is best-paved on Node, so a Bun runtime would spend budget on compat rather than the spatial-systems showcase. Rejected.

**Real-time transport (the brief's deliberate WebSocket pick — justified, not defaulted):**

- **C1. WebSocket via `@fastify/websocket`.** The fleet telemetry is a continuous high-frequency per-tick broadcast, and Atlas has a **genuinely bidirectional** need over the same socket: subscribe/unsubscribe to a viewport or focused vehicle, request a fresh snapshot on reconnect, and (demo) control the simulation. WebSocket's lighter per-message framing and binary-frame capability fit high-rate telemetry, and the single WS connection in DevTools (plus the 1 Hz-data / 60 fps-motion gap from interpolation) is the senior signal. **Picked.**
- **C2. SSE.** Rejected — and the contrast is itself a portfolio signal. SSE is one-directional; Atlas needs client→server control over the same channel (subscription scoping, snapshot requests, sim control), which SSE cannot carry. The portfolio already ships the textbook one-directional-fan-out SSE project (pulse); Atlas is the deliberate bidirectional-high-frequency WebSocket counterpart. Choosing WS here and SSE there, each for the right reason, demonstrates the portfolio picks transport per problem, not by habit.

**Map engine + tile source (HARD keyless constraint):**

- **D1. MapLibre GL JS + a keyless-by-default tile source (optional richer-style key via env).** MapLibre is the open-source, WebGL-rendered, keyless-capable fork of Mapbox GL JS — it supports vector styles, marker rotation, custom layers, and smooth native camera animation, exactly what the "feels alive" wow needs. The committed repo MUST render with no paid secret: a keyless fallback basemap (keyless raster, or self-hosted Protomaps `.pmtiles` — architect picks) renders when no key is present; an optional `NEXT_PUBLIC_MAP_TILE_KEY` (documented in `.env.example`) only enriches the basemap when the owner supplies it at deploy time. **Picked.** **This keyless-by-default rule is a hard gate, flagged for the architect (ADR-006) and every engineer.**
- **D2. Mapbox GL JS.** Rejected — requires a paid access token and a non-open license; violates the keyless constraint outright.
- **D3. Leaflet (raster DOM tiles).** Rejected as the primary — DOM raster tiles cannot do the smooth WebGL marker motion / rotation / camera fly-to at the quality bar, making the wow harder. (The keyless raster fallback inside MapLibre covers the no-vector case without dropping to Leaflet.)

**Geo-math placement + persistence:**

- **E1. turf.js shared FE+BE via `src/lib/geo/`, plain Postgres + `jsonb` GeoJSON (PostGIS as v2).** turf supplies `along`/`nearestPointOnLine`/`length`/`bearing`/`booleanPointInPolygon` for the engine (authoritative) and the client (remaining-route slice, interpolation geometry), shared as pure unit-tested functions — the "heavy domain logic" trigger made concrete and the § 5 single-source discipline applied to algorithms. Persistence is modest (route/zone/stop GeoJSON in `jsonb`, fleet metadata, a bounded telemetry/events history); the authoritative geo computation lives in the engine, not in spatial SQL, so PostGIS's query power is unexercised in v1. Plain Postgres keeps the Fly deploy lean (the pulse/tape posture). **Picked (recommended; architect may overturn in ADR-005 if a prototype shows PostGIS earns its keep).**
- **E2. PostGIS from v1.** Rejected for v1 — a heavier Postgres image, extension setup, and deploy friction for spatial-query power v1 does not use (small known fleet, handful of zones, computed in-engine). Noted as the v2 upgrade if a real spatial-query feature (within-radius, spatial-index viewport culling) is added.

**Simulation engine shape:**

- **F1. A pure tick reducer (`tick(state, dt) -> { state, events }`, no wall-clock inside) driven by an IO shell loop, deterministic from a seed, replayable.** The pure core makes the engine exhaustively unit-testable (same seed + tick count → same world) and seekable (replay to tick T, so the wow beats are reproducible on demand), and makes the in-process-vs-split-worker topology choice orthogonal to the domain logic. **Picked.**
- **F2. An ad-hoc stateful loop with wall-clock and IO inside the advance step.** Rejected — not deterministic, not unit-testable, not replayable; would gut the credibility line (server-authoritative + reproducible) and the demo's on-demand wow beats.

**Animation:**

- **G1. The map motion is hand-rolled rAF interpolation (NOT a library); Motion is the single declarative library, scoped to UI/panel transitions only.** Marker interpolation between authoritative ticks (lerp position along road geometry, shortest-arc heading) is a `requestAnimationFrame` tween driving MapLibre's imperative API off the React render path; camera fly-to is MapLibre native; trails/zone-pulse are MapLibre paint updates. Motion (§ 15 single library) handles only React-state chrome (detail-panel slide, events-feed `AnimatePresence`, fleet selection, toasts, theme crossfade). **Picked.** Per-marker per-frame animation through Motion/React state would be a frame-budget disaster — the exact mistake pulse's "the streaming surface is not Motion" and tape's "Canvas2D is not Motion" rules guard against.
- **G2. Motion (or GSAP/R3F) driving the marker motion.** Rejected — frame-budget disaster (G1) for Motion; GSAP has no scroll-timeline/SVG-choreography role here; R3F is redundant (MapLibre owns the WebGL canvas; we are not stacking a second 3D layer).

**Design tokens:**

- **H1. Sovereign operations/control-room token set, built from scratch, NO reuse from tape/meld/razors-edge/pulse/apex** (`docs/conventions.md` § 14). **Picked / mandatory.** A dark control-room register and a clean light register, with **matching dark + light MapLibre basemap styles** (the theme toggle switches the map style, not just the chrome), both intentional and reviewed in their own right.

### Decision

**Stack flavour: api-heavy. Backend: Fastify on Node 22 LTS, with `@fastify/websocket`, Drizzle + PostgreSQL (plain, `jsonb` GeoJSON; PostGIS deferred to v2), and Zod via `fastify-type-provider-zod`. Real-time transport: WebSocket. Map: MapLibre GL JS, keyless-by-default tile source (optional richer-style key via env). Geo math: turf.js shared FE+BE via `src/lib/geo/`. Simulation: a pure deterministic tick reducer driven by an IO shell. Animation: hand-rolled rAF interpolation for the map + Motion (single declarative library) for UI/panel transitions. Tokens: sovereign operations/control-room, no reuse.**

The picks converge on the project's thesis. **First**, api-heavy is forced three ways over (simulation loop, WebSocket, geo domain logic) — there is no honest web-only build of a server-authoritative live-fleet product. **Second**, Fastify wins on workload fit (a focused, performance-sensitive WS-fan-out + engine-loop + small-REST surface is exactly Fastify's mature-fast-plugin sweet spot, without NestJS's ceremony) and decisively on portfolio variance (it is the one § 11 backend unused; Atlas completes the four-backend story across four api-heavy projects). **Third**, WebSocket wins because the channel is high-frequency telemetry AND genuinely bidirectional (subscription scoping, snapshot requests, sim control over one socket) — the honest distinguishing reason over SSE, and the deliberate counterpart to pulse's SSE. **Fourth**, MapLibre keyless is the only choice that satisfies the hard keyless-repo constraint while delivering the WebGL marker motion the wow needs. **Fifth**, the pure-reducer engine is what makes the sim server-authoritative, deterministic, unit-testable, and replayable (reproducible wow beats). **Sixth**, the map motion lives outside Motion (rAF + MapLibre imperative) to protect the frame budget; Motion is confined to UI chrome.

**Six deeper designs are deliberately deferred** to the architect at the start of implement, pinned against a brief prototype spike rather than locked prematurely by the planner: the simulation engine (ADR-002), the WS contract (ADR-003), the geo math + geofence detection (ADR-004), the data model + persistence (ADR-005), the map engine + tile source (ADR-006), and the deploy topology (ADR-007). Their boundaries are scoped in PLAN.md Phase 0 and listed under "Follow-up" below.

### Consequences

- **Positive.**
  - Four distinct cutting-edge backends across four api-heavy portfolio slots (Elysia/Bun · Hono/Node · NestJS · Fastify). The `docs/conventions.md` § 12 variance target is not just satisfied with margin — every § 11 framework is now represented and the portfolio's backend-variance story is **complete**.
  - Fastify's plugin/encapsulation model keeps the WS gateway, the engine loop, the geo services, and the REST routes as clean, separately-testable units on a performance-sensitive surface, with low broadcast-path overhead.
  - WebSocket is the production-faithful transport for live-fleet telemetry and carries the genuinely bidirectional control channel (scoping, snapshot, sim control) that SSE cannot; the deliberate WS/SSE split across Atlas/pulse is itself a portfolio signal.
  - MapLibre keyless renders the map with no committed secret (the hard constraint), while an optional key only enriches the basemap — a fresh checkout works, and no paid secret ever enters the repo.
  - The pure deterministic tick reducer is the centrepiece "heavy domain logic" senior signal: server-authoritative, exhaustively unit-testable (same seed + ticks → same world), and seekable so the wow beats reproduce on demand. The smooth motion is honest interpolation between authoritative ticks, not faked.
  - turf shared FE+BE keeps the geo math consistent and pure-testable; plain Postgres + `jsonb` keeps the Fly deploy lean (the pulse/tape posture), with PostGIS a clean v2 upgrade.
  - The map motion off the React render path (rAF + MapLibre imperative) protects the 60 fps frame budget; Motion confined to chrome avoids the per-frame-through-React mistake.

- **Negative.**
  - A WebGL map is not natively accessible. Mitigation (a hard success criterion, not optional): a first-class keyboard-navigable, screen-reader-legible **non-map fleet table** carrying the same live data — which doubles as the no-WebGL fallback. The designer-critic and test-engineer verify it as a real view, not a hidden stub.
  - The keyless fallback basemap may look less rich than a keyed vector style. Mitigation: the architect prototypes both in ADR-006 and ensures the keyless fallback is visually acceptable (self-hosted Protomaps `.pmtiles` is the strongest fully-keyless option); the wow lives in the _fleet motion and events_, which is keyless either way.
  - MapLibre needs a Web Worker for tile parsing, so the strict CSP must allow `worker-src 'self' blob:` (and `blob:`/the tile host where needed) WITHOUT opening `unsafe-eval`. This is a known sharp edge (the meld/razors-edge/pulse CSP lesson); the frontend-engineer verifies the exact policy under a `next build && next start` prod build, not `next dev`.
  - The high-frequency broadcast + the per-marker rAF interpolation are the perf hot paths; a careless implementation (React state per tick, marker churn) janks. Mitigation: the off-render-path store + imperative MapLibre updates are pinned now; the reviewer checks the frame budget and the backpressure (coalesce-to-latest-tick) rule.
  - Plain Postgres means no server-side spatial queries; if a v2 feature needs them, a PostGIS migration follows — accepted, since v1's geo is in-engine and the schema stores GeoJSON in `jsonb` that PostGIS can later index.
  - The variance slot "Fastify backend" is now consumed by Atlas; a future brief wanting Fastify for a different reason cannot have it without re-opening the variance plan (though the variance story is now complete, so this is low-stakes).

- **Follow-up (architect, implement-phase day 1, before engineering kickoff).**
  - **ADR-002** — Simulation engine: the pure tick reducer + determinism/seed contract, speed-modulation + dwell-at-stop, route-end behaviour, the `s`→lat/lng/heading projection, in-process vs split worker.
  - **ADR-003** — Real-time WS contract: frame vocabulary (`snapshot`, `tick`/delta, `geofence.event`, `status.change`, `heartbeat`, client→server `subscribe`/`snapshot.request`/`sim.control`), encoding (JSON vs binary/MessagePack), subscription scoping, heartbeat under the Fly edge idle timeout, reconnect/snapshot-resume, backpressure (coalesce-to-latest-tick-per-vehicle).
  - **ADR-004** — Geo math + geofence detection: turf-in-engine placement, shared `src/lib/geo/`, the geofence enter/exit debounce/hysteresis rule, the ETA computation (remaining distance / rolling-avg speed, partial-route handling), FE/BE sharing of the pure functions.
  - **ADR-005** — Data model + persistence: plain Postgres + `jsonb` GeoJSON vs PostGIS (recommend plain), the schema (vehicles, routes, route_stops, zones, telemetry snapshot, events), indexing for the snapshot/events reads, telemetry retention, the `postgres-js` connection strategy.
  - **ADR-006** — Map engine + tile source: the MapLibre marker-rendering approach against smooth interpolation, the keyless tile source (keyless raster vs self-hosted Protomaps `.pmtiles` vs optional free-tier key), dark + light basemaps, and the CSP MapLibre allowances WITHOUT `unsafe-eval`. **Keyless-by-default is a hard gate.**
  - **ADR-007** — Deploy topology: Fly.io for Postgres + the Fastify server/engine (single process or split engine-worker / WS-web) + the Next web; WS over the Fly edge (heartbeat, sticky/single-instance v1); warm-floor posture (the fleet must not cold-start in front of a recruiter); seed-vs-live coexistence; the optional tile-key secret at deploy.
  - **Engineering kickoff (gated on ADR-002 + ADR-005 acceptance):** `backend-engineer` starts the Fastify scaffold (PLAN.md Task 1.1) in parallel with `frontend-engineer` starting the Next.js + Tailwind v4 scaffold (PLAN.md Task 2.1); the two are independent until the WS-client wiring (Task 4.2) consumes the shared Zod WS-frame schema (Task 1.3).

### References

- **`docs/conventions.md` § 10–16** — the hard rules this ADR traces to: § 10 (api-heavy triggers — three fire), § 11 (backend choice serving project + variance; Fastify is the unused framework), § 12 (portfolio composition — Atlas completes the four-backend story), § 14 (sovereign tokens, no reuse), § 15 (single declarative animation library — Motion; the map motion is hand-rolled and outside it).
- **root `PROGRESS.md` § composition tracker** — tape = Elysia/Bun (1), meld = Hono/Node (2), razors-edge = web-only (3), pulse = NestJS (4), apex = web-only (5); Atlas = Fastify (6), the fourth backend.
- **Fastify documentation** — plugins/encapsulation, `@fastify/websocket`, `fastify-type-provider-zod`, `@fastify/rate-limit`.
- **MapLibre GL JS** — keyless vector/raster styles, marker rotation, custom layers, native camera `flyTo`/`easeTo`, the tile-parsing Web Worker (CSP `worker-src`), keyboard navigation.
- **turf.js** — `along`, `nearestPointOnLine`, `length`, `bearing`, `booleanPointInPolygon`, `lineSlice`.
- **Protomaps `.pmtiles`** — the strongest fully-keyless self-hosted vector-tile option for ADR-006.
- **`docs/inspirations.md`** — Linear (alive / micro-interaction + easing register), Vercel (dense-dark control-room restraint), Stripe (premium finish) — the references the designer-critic gates the UI against.
- **pulse `DECISIONS.md` ADR-001 + `AGENT_NOTES.md`** — the "real-time channel is justified, not defaulted" precedent, the "the streaming surface is not Motion" frame-budget discipline (reused here for the rAF interpolation), the seed-vs-live credibility discipline, and the CSP-under-prod-build verification method.
- **meld `DECISIONS.md` ADR-002/ADR-004** — the Node `http.Server` upgrade-routing + WS frame-contract precedent (a Node WS gateway pattern Atlas's `@fastify/websocket` gateway can learn from).
- **tape `AGENT_NOTES.md`** — "Canvas2D is not Motion" and the shared-Zod-frame-contract-as-integration-boundary precedent.
