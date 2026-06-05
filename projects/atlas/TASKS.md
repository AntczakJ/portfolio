# atlas — Tasks

> Granular checklist mirror of PLAN.md. Check items as they land. `S`/`M`/`L` = size; the owner is the responsible subagent. Phases gate as noted (engineering kickoff is gated on ADR-002 + ADR-005).

## Phase 0 — Architecture lock-in (architect)

- [ ] **0.1** ADR-002: Simulation engine — pure tick reducer (`tick(state, dt) -> {state, events}`, no wall-clock), determinism/seed contract, speed-modulation + dwell-at-stop, route-end behaviour, `s`→lat/lng/heading projection (turf), in-process vs split worker. `L` — architect
- [ ] **0.2** ADR-003: Real-time WS contract — frame vocabulary (`snapshot`, `tick`/delta, `geofence.event`, `status.change`, `heartbeat`, client→server `subscribe`/`snapshot.request`/`sim.control`), encoding (JSON vs binary), subscription scoping, heartbeat under Fly edge, reconnect/resume, backpressure (coalesce-to-latest-tick). Zod in `src/lib/schemas/ws/`. `M` — architect
- [ ] **0.3** ADR-004: Geo math + geofence detection — turf-in-engine, shared `src/lib/geo/`, geofence enter/exit debounce/hysteresis, ETA (remaining distance / rolling-avg speed), FE/BE sharing. `M` — architect
- [ ] **0.4** ADR-005: Data model + persistence — plain Postgres + `jsonb` GeoJSON vs PostGIS (recommend plain), schema (vehicles, routes, route_stops, zones, telemetry snapshot, events), indexing, telemetry retention, `postgres-js` connection strategy. `M` — architect
- [ ] **0.5** ADR-006: Map engine + tile source — MapLibre marker approach vs smooth interpolation, keyless tile source (raster vs self-hosted Protomaps `.pmtiles` vs optional key), dark + light basemaps, CSP MapLibre allowances WITHOUT `unsafe-eval`. **Keyless-by-default is a HARD gate.** `M` — architect
- [ ] **0.6** ADR-007: Deploy topology — Fly (Postgres + Fastify server/engine + Next web), WS over Fly edge (heartbeat, single-instance/sticky v1), warm floor, seed-vs-live, optional tile-key secret. `M` — architect

## Phase 1 — Backend scaffold (backend-engineer) — gated on ADR-002 + ADR-005

- [ ] **1.1** Fastify scaffold `projects/atlas/server/` (`atlas-server`, Node 22 `.nvmrc`, TS strict, ESLint flat, Prettier, `fastify-type-provider-zod`, Zod-validated env, `GET /health`). Dev port **3090**; document allocation. `S` — backend-engineer
- [ ] **1.2** Drizzle + Postgres — `docker-compose.yml` Postgres **5438**, schema barrel `src/db/schema/` per ADR-005, migrations, Drizzle client provider. `M` — backend-engineer
- [ ] **1.3** Shared Zod schemas `projects/atlas/src/lib/schemas/` (vehicle, route, stop, zone, telemetry tick, WS frame envelope, control frames); types-only cross-package import seam (pulse/tape `exports` pattern). `M` — backend-engineer
- [ ] **1.4** Shared geo module `projects/atlas/src/lib/geo/` wrapping turf (route projection, length, ETA, point-in-polygon + transition/debounce) — pure functions, FE/BE single source. `M` — backend-engineer

## Phase 2 — Frontend scaffold (frontend-engineer) — gated on ADR-002 + ADR-005 (parallel to Phase 1)

- [ ] **2.1** Next 15 + React 19 + Tailwind v4 + shadcn scaffold `projects/atlas/web/` (`atlas-web`, dev port **3091**), `next-themes`, **sovereign control-room tokens** (NO reuse — § 14), strict CSP with MapLibre allowances + NO `unsafe-eval` (verify prod build), TanStack Query + Zustand + RHF + Zod, app shell (control-room top bar, theme toggle, map + side-panels layout). `M` — frontend-engineer
- [ ] **2.2** MapLibre integration boundary — `'use client'` wrapper owning the instance off the render path, keyless basemap (+ optional-key style) per ADR-006, dark + light styles wired to theme, keyboard nav, CSP-clean prod build; render static seeded fleet + routes + zones as layers. `L` — frontend-engineer

## Phase 3 — The simulation engine (backend-engineer, the api-heavy spine)

- [ ] **3.1** Pure tick reducer per ADR-002 (advance `s`, project to lat/lng/heading via turf, speed modulation + dwell, route-end, ETA, geofence transition + debounce; no IO, no wall-clock). Heavily unit-tested. `L` — backend-engineer
- [ ] **3.2** Engine IO shell — fixed-tick loop driving the reducer, deterministic seed, applying state, handing telemetry + events to the WS gateway + persistence sink; pause/resume/speed/seek (replay) control. In-process or split worker per ADR-007. `M` — backend-engineer
- [ ] **3.3** Persistence + event sink — events feed + bounded telemetry snapshot/history per ADR-005 (engine = source of truth; serves feed + snapshot frame + SSR floor); seed (faker, `faker.seed(n)`, frozen baseline) for demo fleet/routes/zones. `M` — backend-engineer

## Phase 4 — WS gateway + live map + smooth markers (full-stack, the wow)

- [ ] **4.1** Fastify `@fastify/websocket` gateway per ADR-003 — snapshot-on-connect, per-tick broadcast, event frames, heartbeat, client→server control frames, per-connection scoping, reconnect/resume, backpressure (coalesce-to-latest), WS rate limiting; Zod-validated frames at boundary. `L` — backend-engineer
- [ ] **4.2** WS client + interpolation — single-connection WS client (reconnect + snapshot reconcile), off-render-path store (last+next positions), **rAF interpolation loop** (lerp position along route geometry, shortest-arc heading) driving MapLibre marker transforms / GeoJSON source at ~60 fps; the 1 Hz-data / 60 fps-motion gap is the wow; `prefers-reduced-motion` → snap to ticks. `L` — frontend-engineer
- [ ] **4.3** Route trails (fading polyline behind) + remaining-route ahead (turf slice to next stop/end) as MapLibre layers off the render path; zone polygons drawn; zone pulse on geofence event (paint update, reduced-motion safe). `M` — frontend-engineer

## Phase 5 — Fleet panel, ETA, events feed, geofence beats (full-stack)

- [ ] **5.1** Fleet list/panel — every vehicle with status (text label + color, never color-alone), current zone, speed, % route complete, live ETA; click/Enter focuses (MapLibre `flyTo` + pinned detail). **This IS the accessible non-map alternative + no-WebGL fallback — build first-class.** `L` — frontend-engineer
- [ ] **5.2** Vehicle detail panel (Motion slide-in) — route, stops, live ETA ticking, speed, recent events; live from WS store. `M` — frontend-engineer
- [ ] **5.3** Live events feed — geofence enter/exit + status changes at top (Motion `AnimatePresence`, reduced-motion safe), `aria-live="polite"`; the geofence beat (zone highlight + event row + status flip) wired to WS event frames. `M` — frontend-engineer
- [ ] **5.4** Demo/replay affordance — reproduce a wow beat on demand (focus a vehicle approaching a zone; and/or scrub/seek-to-tick replay leveraging the deterministic engine) so the cross-the-boundary beat plays reliably. `M` — full-stack

## Phase 6 — Degradation + a11y + public/SEO surface (full-stack)

- [ ] **6.1** Graceful-degradation matrix — no-WebGL → fleet table (same live data); reduced-motion → snap/cut; no-JS SSR floor (pitch + static fleet snapshot table + route/zone reference); socket-drop → reconnect indicator + freeze + reconcile. All four verified under prod build. `L` — frontend-engineer
- [ ] **6.2** Accessibility pass — non-map fleet table as first-class keyboard/SR view, marker accessible names, status-never-color-alone, keyboard focus flow, `aria-live` event announcements (non-flooding), contrast AA both themes, MapLibre keyboard nav. `M` — frontend-engineer
- [ ] **6.3** Public/landing + SEO — marketing/landing route (pitch + live/static-floor fleet preview), metadata, OG image (`next/og`), JSON-LD, `sitemap.ts`, `robots.ts`, canonical; SSR/static first paint, Lighthouse ≥ 95 all four; public read REST (fleet snapshot/routes/zones) rate-limited. `M` — frontend-engineer

## Phase 7 — Polish + review

- [ ] **7.1** UI milestone review — live map, fleet panel + detail, events feed, table fallback, light + dark — against **Linear** + **Vercel** + **Stripe** (≥ 2 by name, zero pochwał); concrete defect list; frontend-engineer applies. `M` — designer-critic
- [ ] **7.2** Code review — sim reducer (determinism, projection, ETA, geofence debounce invariant), WS gateway (fan-out, scoping, backpressure, reconnect, rate limiting), interpolation loop (off-render-path, frame budget), CSP/MapLibre/keyless verification. `L` — reviewer

## Phase 8 — Tests

- [ ] **8.1** Vitest unit — tick reducer (same seed+ticks → same world; `s`→position; speed/dwell; route-end), geo module (length, projection, ETA vs known-geometry fixtures, point-in-polygon + debounce/hysteresis — boundary-skimmer does not flap), WS frame Zod (round-trip, reject malformed control frames). `L` — test-engineer
- [ ] **8.2** Playwright E2E — map loads + fleet moving (exactly ONE WS connection, not polling); focused-vehicle ETA decrements; geofence event fires + lands on feed (drive deterministic replay/seek, not an organic wait); no-WebGL table fallback renders same live data; reduced-motion does not break live map; keyboard focus flow through fleet list; socket-drop shows reconnect indicator. `L` — test-engineer
- [ ] **8.3** Lighthouse CI ≥ 95 all four categories on the landing/public SEO surface. `S` — test-engineer

## Phase 9 — Docs + deploy

- [ ] **9.1** `README.md` — pitch, wow (GIF of moving fleet + geofence event), stack, run instructions (Postgres + Fastify server/engine + web; keyless map note + optional tile key), demo URL, honest server-authoritative-sim / client-interpolation + seed-vs-live boundary, key decisions, architecture Mermaid diagram (browser ↔ WS ↔ Fastify gateway ↔ engine ↔ geo logic; Postgres; tiles); `CHANGELOG.md` (Keep a Changelog). `M` — doc-writer
- [ ] **9.2** Deploy to Fly per ADR-007 (Postgres + Fastify server + Next web), verify live demo (fleet moves smoothly, a geofence beat plays, landing Lighthouse ≥ 95, keyless map renders with no committed secret); set demo URL in README + root README table. `L` — main thread / backend-engineer
