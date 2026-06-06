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

---

## ADR-002: Simulation engine design — pure tick reducer, fixed dt, in-process loop

**Status:** accepted
**Date:** 2026-06-06

### Context

The simulation is the api-heavy spine of Atlas and the source of the "heavy domain logic" senior signal. It must be **server-authoritative** (positions, headings, speeds, ETAs, route progress, geofence transitions all computed server-side), **deterministic** (same seed + tick count reproduces the same world, for tests and the reproducible wow beats), and **seekable** (so a recruiter can be shown a known geofence crossing on demand). ADR-001 fixed the shape — a pure tick reducer driven by an IO shell — but deliberately deferred the concrete design: the reducer signature and determinism contract, the speed/dwell model, route-end behaviour, the `s`→lat/lng/heading projection, the tick cadence, and (jointly with ADR-007) whether the loop runs in-process or in a split worker. AGENT_NOTES § "Decisions to revisit" flags the in-process-vs-worker call and the tick cadence as assumptions to challenge, not inherit.

### Options considered

**Reducer purity / time source:**

- **A1. Pure reducer `tick(state, dt, rng) -> { state, events }`, no wall-clock, time and randomness injected.** The IO shell owns `Date.now()`, the interval, and the seeded RNG instance; the reducer is a pure function of `(state, dt, rng)`. Deterministic, exhaustively unit-testable, seekable (fold the reducer N times from the baseline to reach tick N). **Picked.**
- **A2. Reducer reads `Date.now()` / `Math.random()` internally.** Rejected — non-deterministic, untestable, unseekable; guts the credibility line (AGENT_NOTES gotcha).

**Determinism / RNG strategy:**

- **B1. Two-phase seeding: `faker.seed(n)` builds the _static baseline_ (fleet, route assignment, per-vehicle base speed, dwell durations) once at seed time and bakes it to a frozen module; a separate small deterministic PRNG (a seeded mulberry32/xorshift carried in engine state) drives _per-tick_ jitter (speed modulation noise).** Keeps faker out of the hot tick path (faker is heavy and the AGENT_NOTES CSP note wants it build-only/static), while still giving deterministic per-tick variation. The PRNG seed is part of engine state, so a fold from baseline to tick N is exactly reproducible. **Picked.**
- **B2. faker called every tick.** Rejected — faker in the per-tick path is slow and pulls a large module into the runtime hot path (the exact thing AGENT_NOTES says to avoid); and threading faker's internal state through a pure reducer is awkward.
- **B3. No per-tick randomness (fully deterministic kinematics, speed a pure function of position).** Tempting for simplicity and it is _more_ reproducible, but the fleet looks robotic — every vehicle on a route moves identically. Rejected as the default; the seeded-PRNG jitter (B1) is cheap and makes the fleet read as alive. (The jitter is bounded and seed-derived, so determinism holds.)

**Tick cadence:**

- **C1. Fixed `dt = 1000 ms` (1 Hz authoritative tick).** Matches the wow thesis exactly: 1 Hz data, 60 fps interpolated motion — the gap is the senior signal, and a moderate (not high) tick rate _maximises_ that gap (more to interpolate, smoother story). At a fleet of 12–30 vehicles a 1 Hz broadcast is trivially within budget. **Picked.**
- **C2. 250 ms / 4 Hz.** Rejected for v1 — narrows the interpolation gap (less to interpolate, weaker wow), 4× the broadcast volume for no product benefit at this fleet size. Noted as a tunable if a future denser fleet needs it; the reducer is dt-parameterised so cadence is config, not a rewrite.
- **C3. Variable dt from wall-clock delta.** Rejected — variable dt breaks reproducibility (the same tick index no longer maps to the same world). The shell uses a **fixed-dt accumulator**: if the loop wakes late, it advances whole fixed-dt ticks to catch up (deterministic), rather than feeding a variable dt into the reducer. Demo speed control multiplies _ticks-per-real-second_ in the shell, never the dt fed to the reducer.

**Route-progress projection (`s` → lat/lng/heading):**

- **D1. Precompute per-route cumulative segment lengths at seed time; per tick, binary-search `s` into the segment table, linear-interpolate the point within the segment, and take the heading as the segment bearing (turf `bearing` on the segment endpoints), via the shared `src/lib/geo/` module.** O(log segments) per vehicle per tick, exact, and the cumulative table is computed once (turf `length` per segment) not per tick. Heading is the segment direction (with shortest-arc smoothing near vertices left to the _client_ interpolation, not the authoritative value). **Picked.**
- **D2. turf `along(route, s)` every tick.** Correct but `along` re-walks the LineString from the start each call (O(segments)); with the cumulative table precomputed the binary search is strictly cheaper and identical in result. Rejected as the per-tick path (turf `along` is still used at seed time and in tests as the reference oracle).

**Speed / dwell model:**

- **E1. Per-vehicle base speed (seeded) modulated by: (i) a smooth taper to near-zero approaching the next stop within a braking distance, (ii) a dwell timer at the stop (status `at_stop`, `s` frozen) for the stop's `dwell_seconds`, then resume, (iii) bounded seeded jitter on the cruise speed.** A small, legible, deterministic model that reads as real delivery motion (slow-in to stops, pause, pull away) without a physics engine. **Picked.**
- **E2. Constant speed, instant stops.** Rejected — vehicles teleport-stop at stops, looks fake, and an instant `s` freeze with no taper makes the interpolation snap.

**Route-end behaviour:**

- **F1. Loop the route (wrap `s` to 0) for _cyclical_ routes (depot circuits) and ping-pong reverse for _linear_ routes, chosen per route by a `loop_mode` field; on wrap/reverse the vehicle keeps its identity and the trail resets.** Keeps the fleet permanently in motion (no vehicle ever goes idle-forever on first paint — the "already moving" requirement), is fully deterministic, and needs no dynamic route-reassignment machinery. **Picked.**
- **F2. Dynamic reassignment to a new route at route end.** Rejected for v1 — adds an assignment policy (which route next?) that is dispatch-workflow scope (explicitly out-of-scope in PLAN.md) for no wow gain; loop/ping-pong keeps the demo alive with far less surface. Noted as a v2 extension point.

**Topology (jointly with ADR-007):**

- **G1. In-process loop in the Fastify server (a fixed-dt accumulator on `setInterval`/`setTimeout`), single instance.** The reducer is pure, so the topology is orthogonal to the domain logic. In-process means **no broker**: the tick output goes straight to the WS gateway via an in-memory event emitter and to the persistence sink via a queued async write. Atlas has **no Redis planned** (AGENT_NOTES), and a single live engine is a single source of truth — the natural fit for a single-instance deploy where every client sees the same fleet. **Picked.**
- **G2. Split engine-worker process + a broker (Redis pub/sub) bridging worker→WS, mirroring pulse's web/worker split.** A stronger raw systems signal, but it reintroduces exactly the broker Atlas was designed to avoid, adds a second Fly process and a worker→WS bridge, and — because the engine is the single source of truth and must stay single-instance anyway — buys no scaling benefit at this fleet size. Rejected for v1. The pure-reducer boundary means promoting to a worker later is a shell change, not a domain change — recorded as the clean v2 path if a real multi-instance or ingestion story arrives.

### Decision

The simulation is a **pure tick reducer** `tick(state: WorldState, dt: number, rng: Prng) -> { state: WorldState, events: SimEvent[] }` with **no wall-clock or IO inside**. Determinism is two-phase: `faker.seed(n)` builds a **frozen static baseline** (fleet, route assignment, base speeds, dwell durations) once at seed time and bakes it to a static module; a **seeded PRNG carried in engine state** (mulberry32) drives bounded per-tick jitter. Cadence is a **fixed `dt = 1000 ms` (1 Hz)** — moderate by design to keep the 1 Hz-data / 60 fps-motion interpolation gap as the wow — driven by a **fixed-dt accumulator** in the IO shell (late wakeups advance whole ticks to catch up; demo speed control scales ticks-per-real-second in the shell, never the reducer dt). Position projection uses a **precomputed per-route cumulative-segment-length table** with a per-tick binary search + within-segment lerp + segment-bearing heading, in the shared `src/lib/geo/` module. The speed/dwell model is **base speed + braking taper into stops + dwell timer + bounded jitter**; route-end is **loop (cyclical) or ping-pong (linear) per a `loop_mode` field**, so the fleet is always moving. The loop runs **in-process in the Fastify server, single instance, no broker** (decided jointly with ADR-007 G1), tick output fanned to the WS gateway via an in-memory emitter and to the persistence sink via a queued write. The reducer is exhaustively unit-tested (Task 8.1); seek-to-tick is a fold of the reducer from the baseline.

### Consequences

- **Positive.**
  - Determinism is airtight: same seed + tick index → same world, so tests assert without sleeps and the wow beats (a specific vehicle entering a specific zone) reproduce on demand by folding to the tick before the crossing.
  - No broker, one process for the engine + gateway: the leanest possible deploy (matches the Fly posture), no worker→WS bridge to build or debug, single source of truth by construction.
  - The 1 Hz cadence deliberately _widens_ the interpolation gap — the senior signal is strongest at a moderate tick rate, and the broadcast is trivially cheap at this fleet size.
  - The precomputed cumulative-length table makes per-tick projection O(log segments) and keeps turf `along` as a clean test oracle.
  - The pure boundary makes the in-process→split-worker move a v2 shell change, not a domain rewrite — the systems-signal upgrade path is preserved without paying for it now.

- **Negative.**
  - Single-instance + in-process means the engine is a single point of failure and does not horizontally scale; accepted for a single-live-view demo (ADR-007 pins single-instance + warm floor anyway). A crash loses in-flight tick index, recovered by re-seeding from the baseline and fast-forwarding (deterministic), or by the persisted snapshot.
  - The seeded-PRNG jitter must be threaded through engine state and folded identically on replay — a discipline the reducer tests must lock (a fixture asserting fold-to-N equals run-to-N).
  - 1 Hz means a vehicle's authoritative position can be up to ~1 s stale between ticks; the client interpolation covers this visually, but the _non-map table fallback_ updates at 1 Hz (acceptable — a dispatcher table at 1 Hz is fine).
  - A fixed-dt accumulator that falls badly behind (a stalled event loop) would burst-advance many ticks on recovery; bounded by a max-catch-up cap in the shell (skip to near-real-time rather than replaying a huge backlog live), recorded as a shell guard for the backend-engineer.

- **Follow-up tasks.** Backend-engineer Task 3.1 (the pure reducer + projection + speed/dwell + route-end + geofence-transition hooks), Task 3.2 (the IO shell: fixed-dt accumulator, seeded PRNG, max-catch-up cap, pause/resume/speed/seek control surface). Test-engineer Task 8.1 asserts fold-to-N determinism and the projection against a known-geometry oracle.

---

## ADR-003: Real-time WS contract — JSON frames, snapshot + coalesced tick, server-scoped subscriptions

**Status:** accepted
**Date:** 2026-06-06

### Context

The WebSocket is the channel the wow rides on and the proof viewer 1 looks for in DevTools (exactly one WS, telemetry frames, no polling). ADR-001 fixed WebSocket via `@fastify/websocket` and deferred the contract. This ADR pins the frame vocabulary, the encoding (JSON vs binary — AGENT_NOTES flags this as an assumption to challenge against the "high-frequency telemetry" framing vs the small fleet), per-connection subscription scoping, heartbeat under the Fly edge idle timeout, reconnect + snapshot-resume, and backpressure (coalesce to latest tick per vehicle). The frame schemas are the **FE/BE integration boundary** — Zod in `src/lib/schemas/ws/`, imported by both `server/` and `web/` (types-only on the web side).

### Options considered

**Frame vocabulary (server→client and client→server):**

- **A1. A tagged-union envelope `{ t: <type>, seq, ... }` with server→client `snapshot` (full world: all vehicles' authoritative telemetry + active zones + server tick index), `tick` (per-tick delta: changed vehicle telemetry since last tick), `event` (a `SimEvent`: `geofence.enter`/`geofence.exit`/`status.change`/`arrived`/`departed`), `heartbeat` (`{ t, serverTick, ts }`); and client→server `subscribe`/`unsubscribe` (scope), `snapshot.request`, `sim.control` (pause/resume/setSpeed/seek). ETA and status are _folded into the per-vehicle telemetry in `tick`_, not separate frames.** One envelope, a small closed set of types, every frame carries a monotonic `seq` for gap detection. **Picked.**
- **A2. Separate top-level `eta.update` and `status.change` frames alongside `tick`.** Rejected — ETA and status are per-vehicle fields that change _with_ position every tick; splitting them into separate frames triples the frame count and de-syncs fields that belong together. `status.change` survives only as an **event** (for the feed), not as a telemetry transport frame — the authoritative status lives in the `tick` telemetry.
- **A3. One firehose frame type (everything in every frame).** Rejected — no snapshot/delta distinction means every frame is a full snapshot (wasteful) or there is no clean reconnect-resume story.

**Encoding (JSON vs binary/MessagePack):**

- **B1. JSON (UTF-8 text frames), with per-tick _delta_ + _coalescing_ keeping frames small.** At 12–30 vehicles, one 1 Hz tick is a few KB of JSON — negligible. JSON is debuggable in DevTools (the recruiter literally reads the telemetry frame), trivially Zod-validated at the boundary, and needs no binary codec on either side. The "high-frequency telemetry" framing in ADR-001 justified _WebSocket over SSE_ (binary-_capable_, bidirectional) — it did not require _actually_ going binary at this fleet size. **Picked.**
- **B2. MessagePack / a compact binary tick.** More production-faithful and lighter on the wire, but at this fleet size the wire saving is irrelevant, it makes the DevTools tell _less_ legible (the recruiter sees opaque bytes, not telemetry — weakening the very signal), and it adds a codec + a binary Zod-bridge on both ends. Rejected for v1; recorded as the v2 lever if the fleet grows an order of magnitude. The contract is **versioned** (`protocolVersion` in the snapshot) so a binary tick can be added behind negotiation later without breaking the JSON path.
- **B3. JSON snapshot + binary tick (hybrid).** Rejected — the complexity of two codecs for a saving that does not exist at this scale.

**Subscription scoping:**

- **C1. Server-side scoping with a default "whole fleet" subscription; `subscribe { vehicleIds? , bbox? }` narrows the per-tick delta the server sends that connection (focused vehicle = higher-detail/guaranteed; viewport bbox = cull off-screen vehicles).** The whole-fleet default means first paint is immediately populated (no empty state); narrowing is an optimisation a focused/zoomed client opts into. Scoping is enforced **server-side** (the server sends only what the connection subscribed to) — never trust the client to filter. **Picked.**
- **C2. No scoping — always broadcast the whole fleet to every connection.** Acceptable at 12–30 vehicles, but it forecloses the bidirectional-control showcase (subscription scoping is part of the ADR-001 WS-over-SSE justification) and the viewport-cull story. Rejected as the _contract_ (though the whole-fleet default means C1 degrades gracefully to C2 behaviour when no narrowing is requested).
- **C3. Client-side filtering of a full broadcast.** Rejected — sends data the client then discards (wasteful) and is not real scoping (the server is still the firehose).

**Heartbeat / Fly edge idle timeout:**

- **D1. Application-level `heartbeat` frame every 20 s server→client carrying `serverTick`, plus WS protocol ping/pong; the client treats >2 missed heartbeats (~45 s) as a dead connection and reconnects.** The Fly edge drops idle connections (~60 s class); a 20 s app heartbeat keeps the connection live _and_ doubles as a liveness/seq check for the client. The 1 Hz tick already keeps the socket busy when the sim runs, but the heartbeat covers paused-sim and quiet-scope cases. **Picked** (the pulse SSE-heartbeat precedent, adapted to WS).
- **D2. Rely on the 1 Hz tick as the keep-alive.** Rejected — a paused sim (demo control) or a tightly-scoped quiet connection would go silent and get edge-dropped; an explicit heartbeat is robust to those.

**Reconnect / snapshot-resume + backpressure:**

- **E1. On connect (and on reconnect), the server sends a `snapshot` first, then `tick` deltas; the client may also `snapshot.request` to force resync. Each frame carries a monotonic `seq`; on a detected gap the client requests a fresh snapshot rather than trusting stale deltas. Backpressure: the server maintains a _per-connection pending-tick buffer that coalesces to the latest tick per vehicle_ — a slow consumer that cannot keep up gets the newest authoritative position, never a replayed backlog of stale positions.** This is the honest "never show stale-as-live" rule (AGENT_NOTES) made concrete. **Picked.**
- **E2. Replay every missed tick to a slow/reconnecting consumer.** Rejected — replays stale motion (the vehicle "catches up" by replaying old positions), which is exactly the stale-as-live failure the credibility line forbids; also unbounded memory for a slow consumer. Coalesce-to-latest is correct.

### Decision

The contract is a **single tagged-union JSON envelope** `{ t, seq, ... }`. Server→client: `snapshot` (full authoritative world + active zones + server tick index + `protocolVersion`), `tick` (per-tick delta of changed per-vehicle telemetry, **ETA and status folded in**), `event` (a `SimEvent` for the feed), `heartbeat` (every 20 s, carrying `serverTick`). Client→server: `subscribe`/`unsubscribe` (`{ vehicleIds?, bbox? }`), `snapshot.request`, `sim.control` (pause/resume/setSpeed/seek). **Encoding is JSON** — the fleet is small, JSON keeps the DevTools tell legible (the recruiter reads real telemetry), and the contract is versioned so a binary tick is a clean v2 lever. **Subscriptions are server-scoped** with a whole-fleet default (first paint is populated); a focused/zoomed client narrows via `subscribe`, enforced server-side. **Heartbeat** is a 20 s app-level frame plus protocol ping/pong, under the Fly ~60 s edge idle timeout; the client reconnects after ~2 missed beats. **Reconnect** sends a fresh `snapshot` then resumes deltas; every frame carries a monotonic `seq` and a detected gap triggers `snapshot.request`. **Backpressure coalesces to the latest tick per vehicle per connection** — a slow consumer gets the newest position, never replayed stale motion. All frames are **Zod-validated at the boundary** (`src/lib/schemas/ws/`); malformed client control frames are dropped and rate-limited (`@fastify/rate-limit`: connection rate + per-connection message rate). Zod runs **jitless** (`z.config({ jitless: true })` early side-effect — AGENT_NOTES CSP/runtime-validation note) since frame validation is a runtime path under the no-`unsafe-eval` CSP.

### Consequences

- **Positive.**
  - JSON keeps the recruiter's DevTools proof legible — they see actual `{ lat, lng, heading, etaSeconds, status }` telemetry, which is a _stronger_ signal than opaque binary at this fleet size.
  - Snapshot-then-delta with `seq` gap detection gives a clean, honest reconnect-resume that never shows stale-as-live; coalesce-to-latest backpressure bounds memory and keeps a slow consumer truthful.
  - Server-side scoping carries the bidirectional-control showcase (the ADR-001 WS-over-SSE justification) and a real viewport-cull path, while the whole-fleet default keeps first paint instant.
  - One Zod envelope shared FE/BE is the single integration boundary (conventions § 5); the web side imports types-only.
  - The versioned protocol leaves a binary-tick upgrade open without a breaking change.

- **Negative.**
  - JSON is heavier than binary on the wire; accepted because the absolute volume is tiny at 12–30 vehicles (re-evaluate only if the fleet grows ~10×).
  - The per-connection coalescing buffer is real gateway state the backend-engineer must implement carefully (one pending-tick map per connection, replaced not appended); the reviewer checks it (Task 7.2).
  - `seq`-gap-triggered snapshot requests add a round trip on a lossy connection; bounded by debouncing snapshot requests so a flapping connection does not snapshot-storm the server.
  - The contract being the FE/BE boundary means a frame-schema change is a coordinated FE+BE change — intended (it is the contract), but it makes the schema file a high-care surface.

- **Follow-up tasks.** Backend-engineer Task 1.3 (the Zod WS-frame schemas in `src/lib/schemas/ws/` — the contract), Task 4.1 (the gateway: snapshot-on-connect, per-tick broadcast, events, heartbeat, control frames, server-side scoping, coalesce-to-latest backpressure, reconnect/resume, rate limiting). Frontend-engineer Task 4.2 (the WS client: single connection, reconnect with snapshot reconcile, `seq`-gap detection, feeding the off-render store). Test-engineer Task 8.1 (frame round-trip + reject-malformed-control-frame), Task 8.2 (exactly-one-WS, no polling).

---

## ADR-004: Geo math + geofence detection — turf in `src/lib/geo/`, hysteresis debounce, rolling-average ETA

**Status:** accepted
**Date:** 2026-06-06

### Context

The geo domain logic is the "test in isolation" trigger made concrete: route projection, ETA, and geofence enter/exit detection are pure functions that must be identical on server (authoritative) and client (remaining-route slice, interpolation geometry), shared through `src/lib/geo/` (conventions § 5 discipline applied to algorithms). ADR-001 fixed turf shared FE+BE and deferred the geofence debounce rule, the ETA computation, and the exact sharing seam. The geofence debounce is a **unit-tested invariant**: a vehicle skimming a boundary must not flap enter/exit/enter (AGENT_NOTES gotcha).

### Options considered

**turf placement / sharing seam:**

- **A1. A `src/lib/geo/` module of pure functions wrapping scoped `@turf/*` modules (`@turf/along`, `@turf/length`, `@turf/bearing`, `@turf/boolean-point-in-polygon`, `@turf/line-slice`, `@turf/distance`), imported by both `server/` (the engine) and `web/` (remaining-route slice + interpolation geometry), types-and-impl shared via the cross-package seam (the pulse/tape `exports` pattern).** Scoped `@turf/*` modules (not the `@turf/turf` mega-bundle) keep the _client_ bundle lean — only the functions the client actually uses ship to the browser. **Picked.**
- **A2. Import `@turf/turf` (the full bundle) in the shared module.** Rejected — pulls the entire turf surface into the web bundle (the landing page has a Lighthouse ≥ 95 budget); scoped modules tree-shake to only what is used.
- **A3. Duplicate the geo math separately on server and client.** Rejected outright — two implementations drift, and the whole point is one tested source of truth (conventions § 5).

**Geofence transition / debounce rule:**

- **B1. Per-(vehicle, zone) state machine with hysteresis: a transition to _inside_ requires the point to be inside the polygon for `>= ENTER_CONFIRM` consecutive ticks (or be inside by `>= margin` distance from the boundary); a transition to _outside_ likewise requires `>= EXIT_CONFIRM` ticks (or outside by `>= margin`). The confirmed state, not the raw per-tick point-in-polygon, drives the `enter`/`exit` event.** Hysteresis (a confirm window + a boundary margin) is the standard anti-flap mechanism; a vehicle skimming the boundary oscillates the _raw_ test but never accumulates enough consecutive confirmations to flip the _confirmed_ state, so no duplicate events fire. **Picked.** This is the unit-tested invariant: a boundary-skimming fixture produces zero spurious events.
- **B2. Raw per-tick point-in-polygon, event on any change.** Rejected — flaps on boundary-skimming (the exact failure the success criterion forbids).
- **B3. Time-debounce only (suppress events within N ms of the last).** Rejected as insufficient alone — a slow skim can flap _outside_ the time window; spatial hysteresis (margin + consecutive-tick confirm) is the robust rule. (A small time floor can layer on top but the spatial confirm is the load-bearing part.)

**ETA computation:**

- **C1. ETA = remaining route distance to the _next stop_ (cumulative-length table: `stop_s - current_s`, partial-route) divided by a _rolling-average speed_ over the last K ticks (not the instantaneous speed), clamped to a sane floor so a dwelling/near-zero-speed vehicle does not report an infinite ETA.** Rolling-average smooths the braking-taper and jitter so the displayed ETA ticks down steadily rather than jittering; partial-route uses the cumulative table from ADR-002. While dwelling at a stop, ETA-to-next-stop is the _dwell remaining_ + onward travel. **Picked.**
- **C2. ETA from instantaneous speed.** Rejected — the braking taper into stops makes instantaneous speed swing wildly near stops, so the ETA would jitter and even spike to huge values as speed → 0; rolling-average is the standard fix.
- **C3. ETA from the route's nominal/scheduled speed.** Rejected — ignores the live speed modulation, so it would not be a _live_ ETA derived from actual progress (the success criterion wants live, recomputed-from-progress ETA).

### Decision

Geo math lives in **`src/lib/geo/`** as pure functions wrapping **scoped `@turf/*` modules** (not the mega-bundle, for a lean web bundle), shared FE+BE via the cross-package types-and-impl seam. The module exposes: route cumulative-length + `s`→{lat,lng,heading} projection (ADR-002's table + binary search), `lineSlice`-based remaining-route and trail geometry (for the client), `length`/`bearing`/`distance`, and the geofence transition tester. **Geofence detection is a per-(vehicle, zone) hysteresis state machine**: enter/exit transitions require `>= CONFIRM` consecutive ticks inside/outside _or_ crossing a boundary `margin`, so the _confirmed_ state (not the raw point-in-polygon) drives exactly one `enter` per genuine crossing and one `exit` later — the unit-tested no-flap invariant. **ETA = remaining-distance-to-next-stop / rolling-average speed over the last K ticks**, partial-route via the cumulative table, clamped at a floor, with dwell-remaining folded in while at a stop. All geo functions are pure and unit-tested against known-geometry fixtures (Task 8.1).

### Consequences

- **Positive.**
  - One tested geo source of truth shared FE+BE — no server/client drift, the "heavy domain logic" trigger made tangible and gradeable.
  - The hysteresis state machine makes the no-flap invariant a clean unit test (a boundary-skimming fixture → zero spurious events) and the geofence beats reliable.
  - Rolling-average ETA ticks down smoothly past the braking taper and dwell, reading as a real live ETA, and recomputes from actual progress.
  - Scoped `@turf/*` keeps the web bundle within the Lighthouse budget.

- **Negative.**
  - The geofence state machine is per-(vehicle, zone) state the engine must carry (and fold deterministically on replay — it lives in `WorldState`, so a seek reconstructs it). More state, but bounded (fleet × zones is small).
  - Hysteresis introduces a small latency: an event fires `CONFIRM` ticks _after_ the raw crossing. At 1 Hz with a small confirm window this is ~1–2 s — within the "~1 tick of the crossing" success-criterion tolerance, and the right trade for no flapping. Tuned and documented.
  - Rolling-average speed needs a per-vehicle ring buffer of recent speeds in state (small, deterministic).
  - The cumulative-length table and the geofence margin must be in the **same units** (metres) and consistent with turf's distance defaults (turf defaults to km — the module pins `units: 'meters'`/`'kilometers'` explicitly everywhere to avoid a units bug; recorded as a sharp edge for the backend-engineer and reviewer).

- **Follow-up tasks.** Backend-engineer Task 1.4 (the `src/lib/geo/` module: projection, length, ETA, point-in-polygon + transition/hysteresis — pure, the FE/BE source). Test-engineer Task 8.1 (route length/projection/ETA against fixtures; the boundary-skim no-flap invariant). Reviewer Task 7.2 checks the units consistency and the debounce invariant.

---

## ADR-005: Data model + persistence — plain Postgres + jsonb GeoJSON, hand-authored demo city, bounded telemetry

**Status:** accepted
**Date:** 2026-06-06

### Context

ADR-001 recommended plain Postgres + `jsonb` GeoJSON + turf-in-engine, PostGIS as v2, but invited the architect to overturn it if a prototype shows PostGIS earns a genuine spatial-systems wow (AGENT_NOTES "Decisions to revisit"). This ADR settles persistence, the Drizzle schema, indexing, telemetry retention, the connection strategy, and the under-determined PLAN items: the **demo city** and **how routes are authored** (the keyless tiles must cover the city).

### Options considered

**Plain Postgres + jsonb vs PostGIS:**

- **A1. Plain PostgreSQL + GeoJSON in `jsonb`, all geo computed in-engine (turf).** The engine is the source of truth for live geo; the DB stores _definitions_ (routes, stops, zones as GeoJSON `jsonb`), fleet metadata, and a _bounded_ telemetry/events history for the feed + snapshot + SSR floor. No spatial query runs server-side in v1 (the fleet is small and known; geo is in-engine). Lean Postgres image, no extension, frictionless on Fly (the pulse/tape posture). **Picked.**
- **A2. PostGIS from v1.** The "real geo DB" wow is real _only if it has a real query to do_. Surveying v1's actual data access — snapshot read (all current telemetry), events feed (recent events), definitions read (routes/zones for the map) — **none of them is a spatial query**; they are ordinary indexed reads by id/time. The authoritative spatial work (point-in-polygon, projection, distance) is in the engine every tick, where it _must_ be (the DB is not in the tick loop). To make PostGIS non-decorative we would have to _invent_ a spatial query (server-side viewport culling, vehicles-within-radius) — but viewport culling is already handled by WS subscription bbox scoping (ADR-003) against in-memory state, far cheaper than a DB round trip per viewport change, and within-radius is not a v1 feature. PostGIS would be a heavier image, an extension to provision, and deploy friction, for a query the architecture does not have. **Rejected for v1** — the default leans lean and the survey confirms PostGIS would be decorative. Recorded as the clean v2 upgrade (the GeoJSON in `jsonb` is PostGIS-indexable later) _if_ a real spatial-query feature lands.
- **A3. SQLite (the conventions showcase option).** Rejected — Postgres is already the portfolio's paved Fly path (pulse/tape/meld), `postgres-js` + Drizzle is the established seam, and there is no reason to diverge.

**Demo city + route authoring:**

- **B1. A real mid-size city's geometry (a compact, recognisable downtown core), with routes **hand-authored as GeoJSON LineStrings** that follow plausible road corridors, and zones hand-drawn as polygons (depots + delivery zones). Coordinates baked into a seeded static fixture module.** Hand-authoring gives full control (the routes look deliberate, cross zones where the wow beats need them, and fit the keyless tile coverage), with no routing-engine dependency (PLAN out-of-scope) and no OSM-extraction pipeline. A real city means the keyless basemap underneath looks real. **Picked** — city: a compact, globally-recognisable core (the backend-engineer pins the exact city + bbox at seed time; the constraint is _keyless tiles must render it well and the bbox must be small enough for a self-hosted `.pmtiles` extract per ADR-006_). A walkable downtown grid (e.g. a Lisbon / Porto / Amsterdam-class core) reads as a believable delivery operation.
- **B2. Routes sampled from real OSM road geometry.** Rejected for v1 — more realistic but adds an OSM extraction + road-snapping pipeline (road-snapping is explicitly out-of-scope), for realism the hand-authored polylines already deliver against a real basemap. Noted as v2 (alongside a routing engine).
- **B3. A fully synthetic grid city.** Rejected — a synthetic grid under a real basemap looks wrong (routes not on roads), and the keyless real-city basemap is the whole point of a recognisable core.

**Telemetry retention:**

- **C1. Bounded retention: persist a periodic snapshot (the latest authoritative per-vehicle telemetry, upserted, not the per-tick firehose) + a capped rolling window of events (the feed + history). The engine is the source of truth; persistence serves the snapshot frame, the events feed, the SSR floor, and reconnect reconcile.** A periodic snapshot (e.g. every few seconds) + a bounded events ring (delete/cap beyond N or beyond a time window) keeps the DB tiny and write-light. **Picked.**
- **C2. Persist every tick (full telemetry firehose).** Rejected — unbounded write volume and table growth for data the engine already holds authoritatively; v1 has no long-horizon-history feature (out-of-scope), so the firehose buys nothing.

**Connection strategy:**

- **D1. `postgres-js` single small pool in the Fastify server, Drizzle on top; the engine writes go through a queued async sink (never block the tick loop on a DB write).** One process (in-process engine, ADR-002), so one small pool; the tick loop hands events/snapshots to an async sink that batches writes off the hot path. **Picked** (the pulse/tape `postgres-js` + Drizzle seam).

### Decision

Persistence is **plain PostgreSQL + GeoJSON in `jsonb`**, all authoritative geo computed in-engine (turf); **PostGIS is rejected for v1** after surveying the actual data access — every v1 read is an ordinary indexed id/time read, no spatial query exists (viewport culling is WS-subscription bbox scoping against in-memory state, not a DB query), so PostGIS would be decorative; it is the clean v2 upgrade (the `jsonb` GeoJSON is PostGIS-indexable later) _if_ a real spatial-query feature lands. The **Drizzle schema** (barrel under `src/db/schema/`): `vehicles` (id, label, type, route_id, base_speed_mps, status, current_zone_id), `routes` (id, name, geometry `jsonb` LineString, length_m, loop_mode), `route_stops` (id, route_id, seq, name, point `jsonb` Point, dwell_seconds), `zones` (id, name, kind, geometry `jsonb` Polygon), `telemetry_snapshots` (latest per-vehicle authoritative telemetry, upserted periodically), `events` (id, vehicle_id, zone_id nullable, type, at, payload `jsonb`). **Indexes:** `events (at desc)` and `events (vehicle_id, at desc)` for the feed reads; `route_stops (route_id, seq)`; `telemetry_snapshots` PK on vehicle_id (upsert). **Retention is bounded**: a periodic snapshot upsert (not the per-tick firehose) + a capped events window. **Demo city is a real compact downtown core with hand-authored GeoJSON routes + zones** (baked into a `faker.seed(n)` static fixture; backend-engineer pins the exact city + small bbox so the keyless `.pmtiles` extract (ADR-006) covers it). **Connection:** one small `postgres-js` pool + Drizzle in the Fastify server; engine writes go through a queued async sink off the tick hot path.

### Consequences

- **Positive.**
  - Lean Postgres, no extension, frictionless on Fly — matches the portfolio deploy posture; the DB is tiny and write-light.
  - GeoJSON in `jsonb` is the natural shape for turf (which speaks GeoJSON) and is PostGIS-indexable later — the v2 upgrade path is clean with no schema rewrite.
  - Hand-authored routes/zones look deliberate, cross zones exactly where the wow beats need them, need no routing engine or OSM pipeline (both out-of-scope), and sit on a real keyless basemap.
  - Bounded retention + queued async sink keep DB writes off the tick hot path and the table from growing unbounded.
  - The schema cleanly serves the snapshot frame, the events feed, the SSR floor (static fleet snapshot table), and reconnect reconcile.

- **Negative.**
  - No server-side spatial queries in v1; a v2 feature needing them requires a PostGIS migration — accepted, and the `jsonb` GeoJSON makes it additive (add the extension + a generated geometry column + a GiST index), not a rewrite.
  - Hand-authoring routes is manual work and must be done carefully so polylines follow visible roads on the chosen basemap and cross the zones the wow needs; mitigated by authoring against the actual keyless tiles and committing the GeoJSON as a reviewed fixture.
  - The periodic snapshot is slightly stale vs the live engine (it lags the latest tick by the snapshot interval); acceptable because the _live_ path is the WS (the snapshot serves SSR floor + reconnect bootstrap, both tolerant of a few seconds' lag — the WS immediately reconciles on connect).
  - Choosing a city with good keyless tile coverage AND a small enough bbox for a self-hosted `.pmtiles` extract is a constraint coupling ADR-005 and ADR-006 — recorded so the backend-engineer and frontend-engineer pin the city jointly at seed/scaffold time.

- **Follow-up tasks.** Backend-engineer Task 1.2 (Drizzle + Postgres, `docker-compose` Postgres on **5438**, schema barrel, migrations, client provider), Task 3.3 (persistence + event sink: bounded snapshot/history, the `faker.seed(n)` frozen baseline for the demo fleet/routes/zones; pin the city + bbox jointly with ADR-006). The city + bbox decision is shared with frontend-engineer Task 2.2.

---

## ADR-006: Map engine + tile source — MapLibre GeoJSON symbol layer, self-hosted Protomaps keyless default, optional key

**Status:** accepted
**Date:** 2026-06-06

### Context

ADR-001 fixed MapLibre GL JS and the **keyless-by-default hard gate** (the committed repo MUST render with no paid secret; a fresh checkout with no `.env` renders the keyless fallback + fleet). It deferred three things to here: the **marker-rendering approach** (against the smooth-interpolation requirement + fleet size 12–30), the **keyless tile source** (keyless raster fallback vs self-hosted Protomaps `.pmtiles` vs optional free-tier key), and the exact **CSP allowances** MapLibre needs WITHOUT `unsafe-eval`. AGENT_NOTES flags the marker approach and the tile-source shape as assumptions to challenge. **Keyless-by-default is non-negotiable.**

### Options considered

**Marker rendering approach (against smooth rAF interpolation):**

- **A1. A single GeoJSON source + a symbol layer (`symbol` with `icon-image` + `icon-rotate` bound to a per-feature `heading` property), updated via `source.setData()` off the React render path by the rAF interpolation loop.** GPU-rendered (scales to the fleet trivially), `icon-rotate` rotates each marker to its heading natively, one `setData` per frame updates all vehicles at once, and it lives entirely off the React render path (the AGENT_NOTES discipline). The rAF loop computes interpolated positions/headings and calls `setData` with the updated FeatureCollection at 60 fps. **Picked.**
- **A2. HTML markers (`maplibregl.Marker`), one DOM node per vehicle, transformed per frame.** Rejected — N DOM nodes transformed every frame is DOM-thrash; rotation is a CSS transform per node, harder to keep crisp, and the DOM-marker path is the classic thing that janks at fleet scale. Acceptable at _tiny_ counts but the wrong tool for smooth 12–30-vehicle motion.
- **A3. A custom WebGL `CustomLayer`.** Maximum control and the best possible smoothness, but the most code (hand-written GL, attribute buffers, a sprite atlas) — over-engineered for 12–30 vehicles when the symbol layer already renders on the GPU and rotates natively. Rejected as over-scope; recorded as the path _if_ the fleet grew to thousands. Trails/remaining-route + zones are separate `line`/`fill` layers updated off-render-path the same way.

**Keyless tile source (the hard gate):**

- **B1. Self-hosted **Protomaps `.pmtiles`** of the demo-city bbox, served as a static asset (single-file `.pmtiles` + the Protomaps MapLibre plugin reading it via HTTP range requests), as the **keyless default**; an optional `NEXT_PUBLIC_MAP_TILE_KEY` switches to a richer hosted vector style when supplied.** This is the strongest keyless option: a real _vector_ basemap (rotates with bearing, looks control-room, dark + light styles), fully keyless, **no third-party tile dependency at demo time** (the tiles ship with the app), and the bbox is small (ADR-005's compact downtown core) so the `.pmtiles` extract is a small static file. **Picked as the keyless default.** The optional key is purely additive (richer style when the owner supplies it); absence renders the self-hosted vector basemap.
- **B2. Keyless OSM **raster** tiles as the default.** Rejected as the _default_ — raster tiles cannot rotate-with-bearing cleanly (the camera fly-to + heading story wants vector), look less control-room, and depend on a third-party raster host at demo time (a tile host that could rate-limit or go down in front of a recruiter). Retained only as a **last-resort fallback** if the `.pmtiles` asset fails to load (a keyless raster style behind a feature check), so there is always _something_. The vector self-host is the default; raster is the floor-of-the-floor.
- **B3. An optional free-tier key (MapTiler/Stadia) as the primary, keyless only as fallback.** Rejected as the _primary_ — it makes the rich look depend on the owner supplying a key, and a fresh checkout would render the lesser fallback. The gate wants the _committed repo_ to look good keyless; self-hosting `.pmtiles` achieves that. The free-tier key stays as the _optional enrichment_ (B1's optional path), not the primary.

**Dark + light basemap:**

- **C1. Two MapLibre style JSONs (a dark control-room style + a clean light style) over the same `.pmtiles` source, switched by `next-themes` (the theme toggle swaps the map style, not just the chrome).** Both authored intentionally (Vercel/Linear control-room register), both reviewed by the designer-critic. **Picked** (ADR-001 mandate). The style swap re-applies on theme change without re-instantiating the map.

**CSP (no `unsafe-eval`):**

- **D1. Strict CSP allowing exactly what MapLibre needs and nothing more: `worker-src 'self' blob:` (MapLibre's tile-parsing Web Worker, created from a blob), `child-src blob:` where required, `img-src 'self' data: blob:` (sprites/glyphs/any raster fallback), `connect-src 'self'` (the `.pmtiles` is same-origin static + the WS endpoint; add the optional tile host only when the optional key is set), `script-src 'self'` (NO `unsafe-eval`), `style-src 'self' 'unsafe-inline'` (MapLibre injects inline styles). Verified under a `next build && next start` PROD build, not `next dev`.** Self-hosting the `.pmtiles` _shrinks_ the CSP surface (the default keyless path is same-origin, so `connect-src 'self'` covers it — no third-party tile host needed unless the optional key is set). **Picked.**

### Decision

Markers are a **single GeoJSON source + symbol layer** (`icon-rotate` bound to a per-feature `heading`), updated via `setData()` off the React render path by the rAF interpolation loop at 60 fps — GPU-rendered, native rotation, scales to the fleet, no DOM thrash. Trails/remaining-route are `line` layers and zones are `fill`+`line` layers, updated off-render-path the same way. The **keyless default is a self-hosted Protomaps `.pmtiles`** extract of the demo-city bbox, served as a same-origin static asset and read via the Protomaps MapLibre plugin — a real keyless _vector_ basemap with **no third-party tile dependency at demo time**, satisfying the hard gate; an optional `NEXT_PUBLIC_MAP_TILE_KEY` (documented in `.env.example`, never committed) switches to a richer hosted style purely additively. A keyless OSM **raster** style is retained only as a last-resort fallback if the `.pmtiles` asset fails. **Dark + light** are two intentional style JSONs over the same source, swapped by `next-themes`. The **CSP is strict and `unsafe-eval`-free**, allowing exactly `worker-src 'self' blob:`, `img-src 'self' data: blob:`, `connect-src 'self'` (same-origin `.pmtiles` + WS; the optional tile host added only when the optional key is set), `script-src 'self'`, `style-src 'self' 'unsafe-inline'` — verified under a prod build (the meld/razors-edge/pulse lesson). Self-hosting `.pmtiles` deliberately _shrinks_ the CSP surface to same-origin.

### Consequences

- **Positive.**
  - The keyless gate is satisfied at its strongest form: a real vector basemap, fully keyless, **no third-party tile host to rate-limit or fail in front of a recruiter** — the tiles ship with the app. A fresh checkout renders the rich basemap + fleet with zero secrets.
  - The GeoJSON symbol layer is GPU-rendered, rotates natively, updates all vehicles in one off-render-path `setData` per frame, and scales past the fleet size — the right tool for smooth 60 fps interpolation.
  - Self-hosting same-origin shrinks the CSP to `connect-src 'self'` for tiles (smaller attack surface, simpler policy) and keeps `unsafe-eval` out.
  - Dark + light styles over one source give the theme-aware control-room map ADR-001 mandates, both designer-critic-gradeable.
  - The optional key is purely additive — it can only _improve_ the basemap, never gate it.

- **Negative.**
  - Producing and committing the `.pmtiles` extract is a build/setup step (extract the city bbox once, commit the static file, wire the Protomaps plugin) — more setup than dropping in a raster URL, but a one-time cost that buys the strongest keyless look. The extract size is bounded by the small bbox (ADR-005); recorded as a frontend-engineer setup task with the city/bbox pinned jointly with ADR-005.
  - The Protomaps MapLibre plugin (`pmtiles` protocol) is an extra dependency and a range-request-served static asset — the deploy must serve the `.pmtiles` with HTTP range support (Next static serving and Fly both do; verified at deploy, ADR-007).
  - Authoring two style JSONs (dark + light) over a vector source is real design work (glyphs, sprite, layer paint) — owned by the frontend-engineer + designer-critic, not free.
  - The `style-src 'unsafe-inline'` allowance is required by MapLibre's injected styles; accepted (it is style-src, not script-src — `unsafe-eval`/`script-src` stay locked). Documented so the reviewer does not flag it as a regression.

- **Follow-up tasks.** Frontend-engineer Task 2.1 (the strict CSP with these exact allowances, verified under a prod build), Task 2.2 (the MapLibre boundary: self-hosted `.pmtiles` keyless basemap + optional-key richer style, dark/light styles wired to the theme toggle, the GeoJSON symbol layer for markers, keyboard nav, render static seeded fleet + routes + zones; pin the city/bbox jointly with ADR-005). `.env.example` documents `NEXT_PUBLIC_MAP_TILE_KEY` as optional with the keyless-fallback behaviour. Reviewer Task 7.2 verifies the CSP + keyless render.

---

## ADR-007: Deploy topology — Fly.io, single-instance Fastify (server + engine + WS), warm floor, Next web

**Status:** accepted
**Date:** 2026-06-06

### Context

ADR-002 decided the engine runs **in-process, single instance, no broker**; this ADR ratifies the matching deploy topology (the two are decided together per AGENT_NOTES) and pins: the Fly machine layout (Postgres + Fastify server/engine + Next web), how the WS survives the Fly edge (heartbeat — from ADR-003 — and the single-instance/sticky requirement), the **warm-floor posture** (the moving fleet must not cold-start in front of a recruiter), seed-vs-live coexistence, the `.pmtiles` range-serving requirement (ADR-006), and the optional tile-key secret handling.

### Options considered

**Process topology:**

- **A1. Single Fastify process hosting the WS gateway + the in-process engine loop + the REST read endpoints, **single instance** (one machine), plus the Next web app, plus Fly Postgres.** The engine is the single source of truth and must be single-instance anyway (every client must see the _same_ fleet); co-locating the engine and the WS gateway in one process means the tick→broadcast path is an in-memory emitter call (no broker, no network hop). **Picked** (the natural consequence of ADR-002 G1).
- **A2. Split engine-worker machine + WS-web machine + a broker (Redis) bridging them.** Rejected for v1 (ADR-002 G2) — reintroduces the broker Atlas avoids, adds a Fly machine + a worker→WS bridge, and buys no scaling benefit because the engine must stay single-instance regardless. The pure-reducer boundary keeps this as a clean v2 path.
- **A3. Engine inside the Next server (no separate Fastify).** Rejected — forecloses the api-heavy showcase (the whole point is a real Fastify server with a real WS gateway and a background loop), and a Next route handler cannot own a persistent high-frequency fan-out + a continuous loop (the ADR-001 api-heavy justification).

**WS over the Fly edge + instance count:**

- **B1. Single instance (one machine, no autoscale-out) so every WS client connects to the one process holding the one live engine; the 20 s app heartbeat (ADR-003) keeps connections under the Fly ~60 s edge idle timeout.** Single-instance makes "every client sees the same fleet" true by construction (no shared engine state, no broker). Sticky sessions are moot with a single instance. **Picked.**
- **B2. Multi-instance behind the Fly edge with sticky sessions.** Rejected for v1 — multiple instances each running their own engine would show _different_ fleets to different clients (no shared source of truth) unless the engine state is shared (a broker), which ADR-002 rejected. Single-instance is correct for a single-live-view demo.

**Warm-floor posture:**

- **C1. `min_machines_running = 1` + `auto_stop_machines = off` for the Fastify server/engine machine (the fleet must be _already moving_ on first paint — a cold start would show a frozen/empty map to a recruiter); the Next web machine can use the lighter posture but the engine machine is pinned warm.** The tape/pulse warm-floor precedent, applied where it matters most (the live engine). **Picked.**
- **C2. Scale-to-zero everywhere.** Rejected for the engine machine — a cold start means the recruiter who opens the link first hits a spin-up and a not-yet-warmed fleet; the wow ("already moving on first paint") demands the engine stay warm. Accepted only for non-critical machines if any.

**Seed-vs-live coexistence:**

- **D1. The `faker.seed(n)` baseline (frozen fleet/routes/zones) is the deterministic starting world; on boot the engine loads the baseline and ticks _forward_ from it (live), persisting a bounded snapshot/events window (ADR-005). Seed is idempotent (re-running does not duplicate); live ticks run forward from the baseline.** The credibility line: the _world definition_ is seeded and reproducible; the _motion_ is live forward ticks (and seekable back to any tick via the reducer fold). **Picked** (the pulse seed-vs-live discipline).

**Optional tile-key secret + `.pmtiles` serving:**

- **E1. The keyless `.pmtiles` is a committed same-origin static asset served with HTTP range support (Next static + Fly both support range requests — verified at deploy); the optional `NEXT_PUBLIC_MAP_TILE_KEY` is a Fly _secret_/build env supplied only at the owner's deploy, never committed. A fresh checkout / the committed repo renders fully keyless.** **Picked** (ADR-006 consequence).

### Decision

Deploy on **Fly.io**: **Fly Postgres** (plain, ADR-005) + a **single Fastify machine** hosting the WS gateway + the in-process engine loop + the REST read endpoints (single instance — the engine is the one source of truth, so every WS client connects to the one process; no broker, the tick→broadcast is an in-memory emitter) + the **Next web** app. The WS survives the Fly edge via the **20 s app heartbeat** (ADR-003) under the ~60 s idle timeout; single-instance makes stickiness moot and "every client sees the same fleet" true by construction. The Fastify/engine machine runs a **warm floor** (`min_machines_running = 1`, `auto_stop_machines = off`) so the fleet is already moving on first paint (no cold start in front of a recruiter) — the tape/pulse precedent. **Seed-vs-live:** the `faker.seed(n)` frozen baseline is the deterministic world definition; the engine ticks forward from it (live) and persists a bounded snapshot/events window; seek replays the reducer fold. The keyless **`.pmtiles` is a committed same-origin static asset served with HTTP range support** (verified at deploy); the optional `NEXT_PUBLIC_MAP_TILE_KEY` is a Fly secret supplied only at the owner's deploy, never committed — the committed repo renders fully keyless. **No Redis** (no broker, no queue). This topology is the direct consequence of ADR-002's in-process single-instance engine.

### Consequences

- **Positive.**
  - The leanest deploy that tells the story: one Postgres, one Fastify machine (server + engine + WS), one Next web, no broker, no extra moving parts — matches the portfolio Fly posture and minimises what can break in front of a recruiter.
  - Single-instance + in-process = single source of truth by construction; every client sees the same fleet with no shared-state machinery.
  - The warm floor guarantees the fleet is already moving on first paint — the wow's "not a static screenshot, already moving" requirement, protected at the infra layer.
  - The committed-static keyless `.pmtiles` means the demo's map has no third-party runtime dependency and no secret — it renders the same on a fresh checkout as on the owner's deploy.
  - The pure-reducer boundary (ADR-002) keeps the split-worker/multi-instance topology a clean v2 move if a real ingestion or scale story ever arrives — without a domain rewrite.

- **Negative.**
  - Single-instance is a single point of failure with no failover; accepted for a demo (a crash re-seeds from the deterministic baseline and fast-forwards, or restores from the persisted snapshot — quick recovery, and the world is reproducible). Documented honestly.
  - The warm floor costs a continuously-running machine (no scale-to-zero on the engine); accepted — the cost is small and the cold-start-in-front-of-a-recruiter risk is unacceptable for the wow.
  - Serving `.pmtiles` needs verified HTTP range support on the deploy path; a misconfiguration would break the keyless basemap — pinned as a deploy verification step (Task 9.2) alongside the keyless-render and Lighthouse checks.
  - The engine machine cannot horizontally scale; fine at this fleet size and for a single-live-view demo, and the v2 split-worker path is reserved.

- **Follow-up tasks.** Main thread / backend-engineer Task 9.2 (deploy: Fly Postgres + single warm Fastify machine + Next web; verify the fleet moves on first paint, a geofence beat plays, the landing scores Lighthouse ≥ 95, the keyless `.pmtiles` renders over range requests with no committed secret, the optional key is a deploy-only secret). Backend-engineer Task 3.2 (the in-process loop + warm-floor-compatible boot: load baseline, tick forward). The `fly.toml` warm-floor + single-instance config is authored at deploy.

---

## Port allocation (confirmed, supersedes the planner's proposal)

The planner proposed Fastify **3090** / Next **3091** / Postgres **5438** (PLAN.md, AGENT_NOTES, PROGRESS.md). **Audit finding: 3090 and 3091 are already taken by apex (slot 5)** — apex-web binds `next dev -p 3090` / `next start -p 3090`, and apex's Playwright E2E binds **3091** (`APEX_E2E_PORT ?? '3091'`). The planner's port-hygiene table in AGENT_NOTES omitted apex's allocation. **The atlas ports are reassigned to avoid the collision:**

- **Fastify server (atlas-server): `3092`** — confirmed free (no repo reference, nothing listening).
- **Next web (atlas-web): `3093`** — confirmed free (no repo reference, nothing listening).
- **Postgres (docker-compose, atlas): `5438`** — confirmed free (taken: tape 5435 / meld 5436 / pulse 5437 / Mila 5434; the only `5438` hit in the repo is an incidental hash substring in tape's `Cargo.lock`, not a port binding).
- **No Redis** — no broker, no queue (ADR-002/ADR-007, in-process single-instance engine).

Full in-use dev-port map at audit time (so future slots avoid these): `3000, 3001, 3055, 3061, 3070, 3080, 3081, 3090, 3091, 3099, 3210, 3999`. PG: `5434, 5435, 5436, 5437`. Atlas claims `3092`, `3093`, `5438`. The backend-engineer (Task 1.1/1.2) and frontend-engineer (Task 2.1) must use **3092 / 3093 / 5438**, NOT the superseded 3090/3091.
