# pulse — Architecture Decision Records

Append-only. New entries are added by the `architect` subagent during the implement phase. The initial entry below is authored by the `planner`.

---

## ADR-001: Stack flavour, backend, real-time channel, data-model posture, animation, and charting

**Status:** accepted
**Date:** 2026-06-03

### Context

`pulse` is a real, working uptime / status monitor — slot 4 in the portfolio. Scheduled probes actually hit endpoints; a live dashboard updates in real time from those real results; an incident state machine turns the raw result stream into a human-meaningful timeline; alerting fires a real outbound webhook on incident open / close; and a public, SEO-friendly status page ships the artifact a real product ships. The dashboard is private (auth); the public status page is unauthenticated.

The audience is dual: (1) a senior backend / fullstack recruiter who must read "this person can build real systems — queues, scheduling, real-time, incident logic" in the first 10 seconds, and (2) a developer who would plausibly use an uptime monitor and exercises the create-monitor / detail / public-page flows. The wow moment serves viewer 1: the live status board reacting in real time to real probes, with an incident opening live (a dot flips red, an incident row grows, an alert fires) and auto-closing on recovery, reproducible on demand via a "Trigger demo incident" affordance.

The owner has fixed the major stack inputs in the brief: **api-heavy, NestJS, BullMQ + Redis, Drizzle + Postgres, better-auth, Zod, clean-modern-SaaS aesthetic, Motion as the single animation library, sovereign tokens.** ADR-001 ratifies those against `docs/conventions.md` and pins the two decisions the brief left for the planner to propose: the **real-time channel (SSE vs WebSocket)** and the **charting approach**.

Portfolio-composition context (root `PROGRESS.md` § tracker): tape (slot 1) committed **Elysia on Bun**; meld (slot 2) committed **Hono on Node**; razors-edge (slot 3) is web-only (the owner's deliberate call). The composition tracker explicitly reserved an **open NestJS api-heavy slot**. Pulse claims it. With Pulse, the portfolio reaches **three api-heavy projects across three distinct backends** (Elysia / Hono / NestJS), which clears the `docs/conventions.md` § 12 target (2–3 api-heavy, ≥ 2 backends, ideally three) — evaluated here at the 4-project mark and satisfied with margin.

### Options considered

**Web-only vs api-heavy:**

- **A. web-only (Next route handlers + server actions).** Rejected by the hard criteria — **four** of the five `docs/conventions.md` § 10 api-heavy triggers fire: a background job queue + scheduler (BullMQ repeatable jobs, the product's spine), an SSE real-time push channel, a heavy auth boundary (two tiers — private dashboard, public status page — plus signed outbound webhooks), and heavy domain logic worth isolating from the UI (the incident state machine, uptime computation, alert de-dup). Any one is sufficient; the scheduler alone forecloses web-only.
- **B. api-heavy.** Forced by A's rejection. **Picked.**

**Backend framework (assuming api-heavy):**

- **B1. NestJS on Node 22.** Opinionated, modular, DI- and decorator-heavy. Pulse's server surface is the largest and most layered in the portfolio — scheduler, worker / processor, incidents, alerts, monitors CRUD, SSE / events, auth, public-status — exactly the multi-module shape NestJS is built for, with first-party `@nestjs/bullmq` + `@nestjs/schedule` integrations and lifecycle hooks (`OnModuleInit` for boot-time repeatable-job reconciliation, `OnModuleDestroy` for graceful queue drain) that make the queue idiomatic instead of hand-wired. Fills the reserved NestJS slot and completes the portfolio's three-backend variance story. **Picked.**
- **B2. Hono on Node.** Already committed by meld (slot 2). Reusing it collapses the variance axis. Rejected on portfolio-composition grounds.
- **B3. Elysia on Bun.** Already committed by tape (slot 1). Same composition rejection; also the BullMQ / ioredis / better-auth ecosystem is best-paved on Node, so a Bun runtime would spend budget on compat rather than on the systems showcase.
- **B4. Fastify on Node.** A legitimate fit technically, but it leaves the NestJS slot unfilled and the portfolio's reserved variance plan unrealised. NestJS's opinionated module structure is also the stronger signal for a systems-engineering product judged by viewer 1. Reserved for a future slot if one genuinely needs Fastify's plugin ecosystem.

**Real-time channel (the planner's call to propose):**

- **C1. SSE over a single long-lived `GET /api/stream`.** The live channel is strictly server → client (probe results, status changes, incident open / close, alert-fired). SSE is the textbook one-directional fan-out tool: plain HTTP (traverses proxies / CDN / Fly edge cleanly, carries cookie auth without a separate handshake), `EventSource` gives automatic reconnect + `Last-Event-ID` resume for free, and NestJS supports it idiomatically via `@Sse()` → `Observable<MessageEvent>`. The DevTools tell (one tidy `text/event-stream` connection) is unambiguous proof to viewer 1 that the board is genuinely pushed, not polled. **Picked.**
- **C2. WebSocket.** Buys bidirectional framing Pulse would never use (all client actions are ordinary authenticated HTTP), at the cost of a heavier protocol, a separate upgrade + auth path, and more moving parts under a reverse proxy. The right call only if the client needed to push high-frequency state over the same socket (meld's cursor / awareness shape) — Pulse has no such need. Rejected; being able to articulate _why not WebSocket_ is the stronger senior signal.

**Charting (the planner's call to propose; architect ratifies the integration boundary):**

- **D1. uPlot for live time series + hand-rolled SVG / CSS for sparklines, uptime bars, status dots.** uPlot is the fastest mainstream time-series library (~40 KB, canvas, imperative `setData` that does not thrash React) — correct for the live response-time chart and the 24h / 7d / 30d detail charts. Sparklines, the green / amber / red uptime history bar, and status dots are small, numerous, and bespoke to the design language, so hand-rolled inline SVG / CSS is cheaper, fully token-styleable, and keeps the per-card cost trivial. **Picked.**
- **D2. Recharts / Tremor.** SVG, React-reconciled per point — re-render the whole chart subtree on data change, wrong for a board where many series update every few seconds. Tremor also imposes its own visual language that would fight the sovereign tokens. Rejected.
- **D3. visx.** Powerful but low-level — we would rebuild much of what uPlot gives for free. Rejected as the primary; could supply a bespoke viz later if needed.

**Animation:**

- **E1. Motion (single library, per § 15).** Scoped to clean-SaaS micro-interactions and live-status state transitions — status-dot crossfade / pulse, incident-row `AnimatePresence` enter / exit, fresh-result card pulse, toast, theme crossfade. State-driven, which is Motion's default register. Crucially the **uPlot charts do NOT go through Motion** (uPlot owns its canvas repaint; per-point animation through Motion would be a frame-budget disaster — the same class of mistake meld's "Canvas2D is not Motion" rule guards against). **Picked.**
- **E2. GSAP / R3F.** No scroll timeline, no SVG-path choreography, no 3D — nothing for GSAP or R3F to do. Rejected.

**Design tokens:**

- **F1. Sovereign clean-modern-SaaS token set (Linear / Vercel / Planetscale register), built from scratch, NO reuse from tape / meld / razors-edge** (`docs/conventions.md` § 14). **Picked / mandatory.** Dark-leaning premium dashboard + a calm, trustworthy public-status register, both intentional in light and dark.

### Decision

**Stack flavour: api-heavy. Backend: NestJS on Node 22 LTS, with Drizzle + PostgreSQL, BullMQ + Redis, better-auth, and Zod. Real-time channel: SSE. Charting: uPlot for live time series + hand-rolled SVG / CSS for sparklines / uptime-bars / status-dots. Animation: Motion (single library). Tokens: sovereign clean-SaaS, no reuse.**

The picks converge on four axes. **First**, api-heavy is forced four ways over (scheduler, SSE, auth, domain logic) — there is no honest web-only build of a real uptime monitor. **Second**, NestJS wins on workload fit (the largest, most layered server surface in the portfolio is exactly NestJS's module-DI-lifecycle sweet spot, with first-party BullMQ / schedule integrations) and on portfolio variance (it fills the reserved third backend and completes the Elysia / Hono / NestJS three-backend story across three api-heavy slots). **Third**, SSE wins because the live channel is strictly server → client one-directional fan-out — SSE is the textbook tool, it is plain HTTP that traverses the edge and carries auth cleanly, and the single `text/event-stream` connection is itself the proof-of-real-time-ness that viewer 1 looks for in DevTools; WebSocket's bidirectionality would be unused ceremony. **Fourth**, uPlot wins because the board updates many time series in real time and uPlot is the only mainstream option built for streaming repaint without thrashing React, while the bespoke small viz (sparklines, uptime bars, dots) is cheaper and more on-brand hand-rolled.

**Five deeper designs are deliberately deferred** to the architect at the start of implement, to be pinned against a brief prototype spike rather than locked prematurely by the planner: the queue / scheduler design (ADR-002), the real-time contract (ADR-003), the incident state machine + uptime computation (ADR-004), the data model + Drizzle posture (ADR-005), and the deploy topology (ADR-006). Their boundaries are scoped in PLAN.md Phase 0 and listed under "Follow-up" below.

### Consequences

- **Positive.**
  - Three distinct cutting-edge backends across the three api-heavy portfolio slots (Elysia / Bun max-throughput · Hono / Node multi-runtime-edge · NestJS / Node opinionated-enterprise). The `docs/conventions.md` § 12 variance target is fully satisfied with margin, and the portfolio's backend-variance story is complete after Pulse.
  - NestJS's module / DI / lifecycle model makes the multi-system surface (scheduler, worker, incidents, alerts, SSE, auth, public) idiomatic — boot-time repeatable-job reconciliation via `OnModuleInit` and graceful queue drain via `OnModuleDestroy` are first-class, not hand-wired.
  - SSE keeps the real-time channel plain-HTTP: cookie auth without a separate handshake, automatic `EventSource` reconnect + `Last-Event-ID` resume, clean edge / proxy traversal, and a DevTools signature that _proves_ the liveness to a skeptical recruiter.
  - The probes are genuinely real — the credibility of the showcase. Seed data makes first load rich; live probes run forward from `now`; the two are cleanly separated and honestly documented.
  - The incident state machine + uptime computation are pure, isolated domain logic — heavily unit-testable against fixtures, which is itself the "heavy domain logic" senior signal and protects the wow moment from regressing.
  - uPlot keeps the live charts crisp and cheap under frequent repaint without dragging a heavy SVG chart lib into every card; the sovereign tokens drive the chart colors so it reads as one design language.

- **Negative.**
  - NestJS carries the most boilerplate / ceremony of the four backend options. Mitigation: the module ceremony is justified by the genuinely multi-module surface here (unlike meld, where it would have dominated a tiny surface) — but the reviewer should watch for over-abstraction that does not earn its keep.
  - SSE is one-directional only. If a future feature needs the client to push over the live channel (it does not in v1), it would require a WebSocket migration — accepted, because no such need exists and the architect designs the worker → Redis pub/sub → SSE source so the read side is replaceable.
  - The deployed demo runs three stateful pieces (Postgres + Redis + the NestJS API/worker) plus the Next web — more deploy surface and more cost than the prior projects. ADR-006 pins the topology and the warm-floor / cost posture (the wow moment must not cold-start in front of a recruiter).
  - check_results is a high-volume time-series table; without a retention / down-sampling call it grows unbounded on a long-running demo. ADR-005 pins the retention window + rollup posture.
  - The prober is an outbound-HTTP primitive — an SSRF risk if a malicious monitor target points at internal / metadata addresses. Mitigation is a mandatory SSRF guard (block private / loopback / link-local / metadata ranges) enforced at both monitor-create validation and probe-execution time; called out as a success criterion and a Phase 1 / Phase 2 task, and unit-tested.
  - The variance slot "opinionated-enterprise NestJS backend" is now consumed by Pulse; a future brief wanting NestJS for a different reason cannot have it without re-opening the variance plan.

- **Follow-up (architect, implement-phase day 1, before engineering kickoff).**
  - **ADR-002** — Queue + scheduler design: BullMQ repeatable-job lifecycle (register / update / remove per monitor + interval change), retry + backoff, per-job timeout, worker concurrency + rate limiting, idempotent one-result-per-check, `OnModuleInit` boot reconciliation.
  - **ADR-003** — Real-time contract: SSE event envelope + named-event vocabulary (`result`, `status-change`, `incident-open`, `incident-close`, `alert-fired`, `heartbeat`), `Last-Event-ID` resume, worker → server-event-subject handoff, the Redis pub/sub fan-out bridge for multi-replica (designed-in, single-instance in v1), and auth scoping (only the owner's monitor events reach the owner's stream).
  - **ADR-004** — Incident state machine + uptime computation: open / close thresholds (N consecutive fails → open, M consecutive successes → close), degraded vs down classification, flap suppression, single-incident-per-outage invariant, and uptime-% windowing over 24h / 7d / 30d from the raw result stream.
  - **ADR-005** — Data model + Drizzle posture: ratify / refine the PLAN.md data-model sketch, time-series indexing for the uptime-window + recent-checks reads, check_results retention / down-sampling, and the Postgres connection strategy under a separate worker process.
  - **ADR-006** — Deploy topology: Fly.io for Postgres + Redis + the NestJS API/worker (one process or split web/worker) + the Next web; the demo-incident mechanism (owned flaky endpoint vs toggle); seed-vs-live coexistence on the deployed demo; warm-floor / cost posture.
  - **Engineering kickoff (gated on ADR-002 + ADR-005 acceptance):** `backend-engineer` starts the NestJS scaffold (PLAN.md Task 1.1) in parallel with `frontend-engineer` starting the Next.js + Tailwind v4 scaffold (PLAN.md Task 3.2); the two are independent until the SSE client wiring (Task 3.3) consumes the shared Zod SSE-envelope schema (Task 1.4).

### References

- **`docs/conventions.md` § 10–16** — the hard rules this ADR traces to: § 10 (api-heavy triggers — four fire), § 11 (backend choice serving project + variance), § 12 (portfolio composition — Pulse completes the three-backend story), § 14 (sovereign tokens, no reuse), § 15 (single animation library — Motion).
- **root `PROGRESS.md` § composition tracker** — the reserved open NestJS api-heavy slot that Pulse claims; tape = Elysia/Bun (slot 1), meld = Hono/Node (slot 2), razors-edge = web-only (slot 3).
- **NestJS documentation** — modules / DI / providers, lifecycle hooks (`OnModuleInit`, `OnModuleDestroy`), guards / interceptors, `@nestjs/config`, `@nestjs/bullmq`, `@nestjs/schedule`, `@Sse()` → `Observable<MessageEvent>`.
- **BullMQ documentation** — repeatable jobs, retries / backoff, worker concurrency + rate limiting, graceful shutdown; Redis as the backing store.
- **uPlot** — streaming-time-series canvas charting, imperative `setData`, bundle size.
- **better-auth** — session-based auth for the NestJS dashboard boundary; the public read surface stays unauthenticated.
- **`docs/inspirations.md`** — Linear (alive / micro-interaction bar, easing register), Vercel (dense-dark restraint), Stripe (premium finish) — the references the designer-critic gates the UI against.
- **meld `DECISIONS.md` ADR-001 + `AGENT_NOTES.md`** — the "real-time channel is justified, not defaulted" precedent and the "the streaming surface is not Motion" frame-budget discipline reused here for uPlot.

---

## ADR-002: Probe scheduler, BullMQ design, and the SSRF guard

**Status:** accepted
**Date:** 2026-06-03

### Context

The probe scheduler is the api-heavy spine of Pulse: each monitor must have its HTTP(S) target checked on its configured interval, forever, surviving process restarts, with retries, per-check timeouts, and bounded worker concurrency. ADR-001 fixed BullMQ + Redis as the queue. This ADR pins the concrete design left deferred (PLAN.md Task 0.1): how a monitor maps to a repeatable job, how create/edit/pause/delete reconciles that job without leaking stale repeatables (the well-known BullMQ repeatable-job-key churn problem), the worker model (concurrency / retry / backoff / timeout / overlap), what one check result captures, the prober HTTP client policy, and — security-critical, because users supply arbitrary target URLs — the SSRF guard.

This is "pinned to a short prototype during implement", so every choice below is specific and committed, not a menu.

### Options considered

**A — Monitor-to-job mapping (how a monitor becomes a recurring check):**

- A1: **One BullMQ repeatable job per monitor**, added with `repeat: { every: interval_seconds * 1000 }` and a **stable scheduler id derived from the monitor id** (`probe:<monitorId>`). The job's data payload is just `{ monitorId }` — the worker re-reads the monitor row at execution time so an edit to (e.g.) the timeout takes effect on the next run without re-touching the queue. **Picked.**
- A2: One repeatable job per monitor keyed by `monitorId + interval` (interval in the key). Rejected: it makes the key churn problem worse — every interval change mints a new key and the old repeatable must be hunted down and removed, and a missed removal accumulates a ghost schedule that double-probes.
- A3: A single global cron tick (e.g. every 10 s) that scans all due monitors and enqueues one-shot jobs. Rejected for v1: it re-implements a scheduler BullMQ already gives, couples all monitors to one tick granularity, and loses BullMQ's per-job repeat semantics — but noted as the pattern to reach for if monitor count ever made per-monitor repeatables heavy (not a concern at portfolio scale).

**B — Reconciliation strategy (the churn problem):**

- B1: **Remove-then-add on every mutation, plus an `OnModuleInit` boot reconciliation that treats the DB as the source of truth.** On create/edit/resume: remove the monitor's job scheduler by its deterministic id (`queue.removeJobScheduler` / `removeRepeatable`), then re-add with the current interval. On pause/delete: remove only. On boot: load all non-paused monitors, diff against the queue's existing scheduler set, add missing, and **remove any scheduler whose monitor no longer exists or is paused** (orphan sweep). **Picked.** A deterministic scheduler id per monitor (`probe:<monitorId>`) is what makes remove idempotent and the orphan sweep possible.
- B2: Rely on BullMQ to dedupe by repeat options. Rejected: classic BullMQ trap — changing `every` produces a different internal repeat-key, the old one keeps firing, and you accumulate stale repeatables. The whole point of B1 is to never depend on BullMQ's implicit keying.

**C — Worker model:**

- C1: **Single worker process, concurrency 20, BullMQ limiter `{ max: 50, duration: 1000 }`, per-attempt timeout enforced by the prober's own `AbortController` (not by BullMQ), `attempts: 2` with `backoff: { type: 'fixed', delay: 2000 }`, `removeOnComplete: { count: 200 }`, `removeOnFail: { count: 500 }`.** A failed HTTP probe is **not** a failed BullMQ job — see the Decision. **Picked.**
- C2: High concurrency / no limiter. Rejected: a burst of due monitors could open dozens of simultaneous outbound sockets and trip the host; the limiter keeps outbound probe pressure bounded and predictable on a small Fly machine.

### Decision

**Each monitor maps to exactly one BullMQ repeatable job with a stable scheduler id `probe:<monitorId>` and `every = interval_seconds * 1000`; the job payload is only `{ monitorId }` and the worker re-reads the monitor row at run time.** Mutations reconcile by **remove-then-add** on the deterministic id, and `OnModuleInit` runs a **boot reconciliation against the DB as source of truth** (add missing schedules, sweep orphaned/paused ones), so a restart never loses or duplicates a schedule and interval edits never leak stale repeatables.

The **worker** is a single BullMQ `Worker` with concurrency 20 and a `{ max: 50, duration: 1000 }` limiter. A check attempt has a hard per-attempt timeout via an `AbortController` set to `monitor.timeout_ms` (default 10 000, cap 30 000). **Missed-run / overlap:** because a check is short relative to its interval and BullMQ's repeatable enqueues the next occurrence on schedule, overlap is avoided in practice; a stalled job is reclaimed by BullMQ's stalled-job machinery rather than double-recorded, and the idempotent write below guards against a reclaimed-then-retried occurrence writing twice.

**One check result captures:** `monitor_id`, `checked_at` (server clock at completion), `status` (`up` | `degraded` | `down`), `status_code` (nullable), `response_time_ms` (nullable), and `error` (a **normalised error class** string, not a raw message — one of `timeout` | `dns` | `connection_refused` | `tls` | `ssrf_blocked` | `http_error` | `keyword_missing` | `unknown`, nullable when up). Classification: **down** = transport error, timeout, status not matching `expected_status` (default 2xx), or `expected_keyword` set and absent from the body; **degraded** = the check passed all assertions but `response_time_ms > monitor.degraded_threshold_ms`; **up** = passed and fast. **Recording is idempotent per occurrence:** the worker writes exactly one `check_results` row per probe run; the write is the last step and a BullMQ retry of the same job occurrence that already wrote does not write a second row. **A failing endpoint is a successful job that records a `down` result** — BullMQ `attempts`/`backoff` are reserved for _infrastructure_ faults (e.g. the worker cannot reach Postgres to record the row), never for "the target was down", so a down endpoint is never retried-as-if-broken and never inflates the result count.

**Prober HTTP client policy (committed):** native `fetch` (undici) with `redirect: 'manual'` — **redirects are followed manually, up to 5 hops, re-running the SSRF guard on every hop's resolved IP**, never `redirect: 'follow'` (which would bypass per-hop SSRF checks). `AbortController` timeout = `monitor.timeout_ms`. **Response body is read with a hard cap of 512 KB** (stream and abort past the cap) so a giant body cannot exhaust memory; only the first 512 KB is searched for `expected_keyword`. No cookies, no credentials forwarded, a fixed `User-Agent: Pulse-Probe/1.0 (+https://<demo-host>)`. Only `http:` and `https:` schemes; anything else is `ssrf_blocked`.

**SSRF guard (hard requirement, not optional) — resolve-then-pin:**

1. **Scheme allowlist:** only `http`/`https`. Reject `file:`, `gopher:`, `ftp:`, `data:`, etc.
2. **Reject credentialed URLs** (`user:pass@host`).
3. **DNS resolve, then validate the resolved IP(s), then connect to the validated IP** — defeating DNS rebinding. The guard resolves the hostname, checks **every** returned A/AAAA record against the denylist, and if any resolves into a blocked range the whole probe is rejected (`ssrf_blocked`). Where the runtime allows, the connection is then pinned to the validated IP (undici custom `lookup`/dispatcher) so a rebind between resolve and connect cannot slip through; where pinning is impractical, the guard re-resolves at the connect boundary and on every redirect hop.
4. **Denylist (IPv4 + IPv6):** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8` (loopback), `169.254.0.0/16` (link-local **incl. `169.254.169.254` cloud metadata**), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, multicast/reserved; IPv6 `::1` (loopback), `::/128`, `fc00::/7` (ULA), `fe80::/10` (link-local), and **IPv4-mapped IPv6** (`::ffff:0:0/96`) decoded and re-checked against the IPv4 denylist.
5. **The guard runs in two places:** at **monitor-create/edit validation** (fail fast, reject obviously-internal targets in the API with a clear error) **and at every probe execution** (the authoritative check — DNS can rebind between create and run). The execution-time check is the one that actually protects the host; the create-time check is UX.

The guard is a pure function `assertProbeTargetAllowed(url, resolvedIps)` in `server/src/probe/ssrf-guard.ts`, unit-tested against every blocked range (PLAN.md Task 8.1).

### Consequences

- **Positive.** Stable per-monitor scheduler ids + DB-as-source-of-truth reconciliation make the schedule self-healing across restarts and immune to the BullMQ stale-repeatable churn. The "down endpoint is a successful job that records `down`" rule keeps BullMQ retries meaning _infrastructure fault_, which keeps the result stream honest (exactly one row per real probe). The resolve-then-pin SSRF guard closes the cloud-metadata / rebinding hole that naive `fetch(url)` probers leave open — itself a senior-signal detail a reviewer looks for.
- **Negative.** Manual redirect handling + per-hop SSRF re-checking is more code than `redirect: 'follow'`, and IP pinning via a custom undici dispatcher is fiddly on Node; mitigation is the re-resolve-on-every-hop fallback, which is correct if slightly slower. Boot reconciliation must diff carefully — an over-eager orphan sweep that mis-identifies a live monitor's scheduler would silently stop probing it; the reconciliation is unit-tested and logs every add/remove.
- **Follow-up tasks.** `backend-engineer`: Task 1.5 (monitor mutation → scheduler reconcile + create-time SSRF check), Task 2.1 (prober + execution-time SSRF guard + classification), Task 2.2 (`OnModuleInit` boot reconciliation + orphan sweep), Task 2.3 (one-result-one-event). `test-engineer`: Task 8.1 (SSRF ranges, classification, idempotency). The SSRF denylist and the resolve-then-pin rule are recorded in AGENT_NOTES as a hard gate.

### References

- **BullMQ** — repeatable jobs / job schedulers, `removeJobScheduler` / `removeRepeatable`, worker concurrency + limiter, `attempts` / `backoff`, stalled-job reclaim, `OnModuleInit` registration via `@nestjs/bullmq`.
- **PLAN.md** Tasks 0.1, 1.5, 2.1–2.3, 8.1; data-model sketch (`check_results`, `monitors`).
- **AGENT_NOTES.md** — "SSRF guard scope" and "single process vs split web/worker" (the worker model here assumes the split pinned in ADR-006).
- **OWASP SSRF Prevention Cheat Sheet** — resolve-then-validate-then-pin, deny private/link-local/metadata ranges, IPv4-mapped-IPv6 decoding.

---

## ADR-003: Real-time SSE contract and the worker -> SSE Redis bridge

**Status:** accepted
**Date:** 2026-06-03

### Context

ADR-001 ratified SSE as the live channel (strictly server -> client). This ADR pins the contract deferred in PLAN.md Task 0.2: the named-event vocabulary with Zod payload shapes, the two channel scopes (authenticated dashboard vs unauthenticated public status page), how auth attaches to an `EventSource` that cannot set headers, the **worker -> SSE bridge** (the load-bearing plumbing, because ADR-006 splits the BullMQ worker into a separate process from the API/SSE server so the worker cannot push into the API's in-memory event subject directly), and reconnection / heartbeat / backpressure under the Fly edge.

### Options considered

**A — The worker -> SSE bridge (separate processes must share an event spine):**

- A1: **Redis Pub/Sub fan-out.** The worker publishes every domain event to a Redis channel; each API replica's SSE layer holds one `ioredis` subscriber connection, receives every event, and relays it to the locally-connected `EventSource` clients scoped to see it. **Picked.** It is the simplest correct fan-out for "one worker, N API replicas", needs no new infra (Redis is already present for BullMQ — use a **separate ioredis connection**, since a subscriber connection cannot also issue normal commands), and matches the design ADR-001 already promised.
- A2: BullMQ `QueueEvents`. Rejected as the primary: `QueueEvents` reports _job_ lifecycle (completed/failed), not our _domain_ events (`status.change`, `incident.open`), so we would still need a second channel for incident/alert events — Redis Pub/Sub carries all of them uniformly.
- A3: Redis Streams. Rejected for v1: Streams add consumer-group/ack/replay machinery we do not need for an ephemeral live feed (SSE resume is a short ring buffer, see below). Pub/Sub's fire-and-forget fits a live board; a missed event during a blip is reconciled by the client's TanStack Query refetch on reconnect.

**B — Auth on the `EventSource` (it cannot set headers):**

- B1: **Cookie-based.** `new EventSource('/api/stream', { withCredentials: true })` sends the better-auth session cookie automatically; a NestJS guard on the `@Sse()` route validates the session and binds the stream to that user's monitor set. **Picked** — exactly why SSE-over-cookies was an ADR-001 argument. The public stream needs no auth.
- B2: Token-in-querystring (`/api/stream?token=...`). Rejected: tokens leak into logs/referers, and we already have a cookie session — no reason to invent a second credential.

### Decision

**Event vocabulary (named SSE events; payloads are Zod schemas in `src/lib/schemas/events.ts`, the shared FE/BE contract per conventions § 5):**

- `check.result` — `{ monitorId, status, statusCode, responseTimeMs, checkedAt }`. Highest volume; drives sparkline appends and the "last checked" ticker.
- `status.change` — `{ monitorId, from, to, at }`. Emitted only when a monitor's derived status transitions, so the board can pulse the dot without diffing every `check.result`.
- `incident.open` — `{ incidentId, monitorId, severity, startedAt, cause }`.
- `incident.close` — `{ incidentId, monitorId, startedAt, resolvedAt, durationMs }`.
- `alert.fired` — `{ incidentId, monitorId, channelType, transition, deliveredAt, status }` (drives the toast; never carries the webhook secret).
- `heartbeat` — `{ ts }` every 15 s (see backpressure/keep-alive).

Every event is wrapped in a common envelope `{ id, type, ts, scope, payload }` validated by `sseEventSchema`. `id` is a monotonic per-stream sequence used for `Last-Event-ID`. `scope` is `dashboard:<userId>` or `public:<statusPageId>` and is the routing key.

**Channel scoping — two `@Sse()` routes:**

- `GET /api/stream` (**authenticated dashboard**): a NestJS auth guard validates the session cookie; the stream emits only events whose monitor belongs to the session user. The server filters by joining the event's `monitorId` to the user's monitor id set (cached per connection, refreshed on `monitor.*` mutations).
- `GET /api/public/:slug/stream` (**unauthenticated public status page**): no auth; emits only `status.change` / `incident.open` / `incident.close` (no raw `check.result`, no `alert.fired`) for the **public monitor set** of that status page. The public stream deliberately exposes less.

**The worker -> SSE bridge:** the worker (separate process, ADR-006) publishes each domain event as JSON to a single Redis channel `pulse:events`. Every API replica runs an `EventsBridgeService` (`OnModuleInit`) holding a **dedicated ioredis subscriber** on `pulse:events`; on each message it validates with `sseEventSchema`, pushes into an in-process RxJS `Subject<SseEnvelope>`, and the two `@Sse()` routes are RxJS pipelines that **filter that subject by scope** (dashboard route to the connected user's monitors; public route to the page's public monitors) before mapping to `MessageEvent`. v1 deploys one API instance, but because the _source_ is Redis Pub/Sub, scaling to N API replicas is a config change, not a redesign.

**Reconnection / heartbeat / backpressure:**

- **Resume:** each API instance keeps a small in-memory **ring buffer (last 256 events per scope)**; on reconnect the browser sends `Last-Event-ID`, and the route replays buffered events with a higher id before resuming live. Events older than the buffer are _not_ replayed — the client instead does a one-shot TanStack Query refetch of current monitor state on `EventSource` `open`, so a long disconnect reconciles via REST rather than via the stream (Pub/Sub is fire-and-forget; this is the deliberate consistency model).
- **Heartbeat:** a `heartbeat` event every 15 s keeps the connection from being reaped by the **Fly edge idle timeout** (~60 s) and lets the client detect a dead link. An initial `: connected\n\n` comment is sent immediately so proxies flush headers.
- **Backpressure:** the per-connection pipeline does not buffer unboundedly — `check.result` is the only high-rate event and it is **coalesced per monitor** (only the latest pending `check.result` per monitor is kept) so a slow consumer drops intermediate points (the chart refetches its window anyway) rather than growing memory. Heartbeats and incident/alert events are never coalesced.

### Consequences

- **Positive.** Redis Pub/Sub gives a clean worker->API decoupling that makes the split-process topology (ADR-006) honest and multi-replica-ready without new infra. The Zod-validated envelope is the same file FE and BE import, so the contract cannot drift. Cookie auth on the dashboard stream needs no second credential. The public stream exposing strictly less is a real privacy boundary, not a UI nicety.
- **Negative.** Pub/Sub is fire-and-forget, so a missed event during a reconnect gap is reconciled by REST refetch, not replayed past the 256-event ring — accepted (a live board does not need perfect event history; the source of truth is Postgres). The per-connection user-monitor filter must be invalidated when the user adds/removes a monitor mid-stream, or a new monitor's events would not reach an open dashboard — handled by refreshing the connection's monitor-id set on `monitor.*` mutations.
- **Follow-up tasks.** `backend-engineer`: Task 1.4 (the `events.ts` Zod envelope in shared schemas), Task 2.3 (worker publishes to `pulse:events`), Task 3.1 (the two `@Sse()` routes + bridge + ring buffer + heartbeat + scope filter). `frontend-engineer`: Task 3.3 (`EventSource` client, `withCredentials`, refetch-on-open reconciliation, feed events into TanStack Query cache / Zustand). The "Pub/Sub is fire-and-forget; reconcile via REST on reconnect" rule and the dedicated-subscriber-connection gotcha go to AGENT_NOTES.

### References

- **NestJS** `@Sse()` -> `Observable<MessageEvent>`; guards for the dashboard route.
- **ioredis** — a subscriber connection cannot issue normal commands; use a dedicated connection for `pulse:events`.
- **PLAN.md** Tasks 0.2, 1.4, 2.3, 3.1, 3.3; ADR-001 SSE rationale and the promised Redis pub/sub bridge.
- **Fly.io** edge idle-timeout behaviour for long-lived `text/event-stream` connections (heartbeat keep-alive).

---

## ADR-004: Incident state machine and uptime computation

**Status:** accepted
**Date:** 2026-06-03

### Context

A stream of raw check results must become a human-meaningful incident timeline and a trustworthy uptime percentage. PLAN.md Task 0.3 deferred the exact thresholds, the degraded-vs-down semantics, flap suppression, the single-incident-per-outage invariant, and the uptime windowing. The incident engine (PLAN.md Task 5.1) consumes the check-result domain event stream; it is pure domain logic that must be heavily unit-tested (a success criterion). This ADR pins it as an explicit state machine plus a defined uptime computation.

### Options considered

**A — What drives the state machine:**

- A1: **Consecutive-count debounce on the derived per-check status.** N consecutive non-`up` results open an incident; M consecutive `up` results close it. Simple, deterministic, unit-testable against a sequence fixture, and the industry-standard model (UptimeRobot / BetterStack "confirmation" count). **Picked.**
- A2: Time-window ratio (e.g. ">50% failures in 5 min"). Rejected for v1: harder to reason about and to unit-test deterministically, and it interacts badly with variable intervals. The consecutive-count model is the clearer senior-signal and matches what the products do.

**B — Uptime computation:**

- B1: **Result-based, computed on the fly from `check_results` within the window**, degraded counted as partial. Cheap and exact for short windows but costly for long ones.
- B2: **Incident-based** (downtime = summed open incident durations). Cleaner narrative but loses sub-incident degraded time and depends on incident boundaries.
- B3: **Hybrid: result-based for 24h (cheap, exact), rollup-table-based for 7d/30d** (pre-aggregated, see ADR-005). **Picked.**

### Decision

**The state machine (per monitor), explicit.** States: `up`, `degraded`, `down` (the live monitor status); an incident is `open` or not. Configurable per monitor with defaults **failure threshold N = 3**, **recovery threshold M = 2**, evaluated on the sequence of derived per-check statuses (from ADR-002's classification).

- Maintain two counters per monitor: `consecutiveBad` (a `down` or `degraded` increments; an `up` resets to 0) and `consecutiveGood` (an `up` increments; a non-`up` resets to 0). Worst severity seen is tracked separately.
- **Open:** when `consecutiveBad` reaches N **and no incident is open**, open **exactly one** incident; its `severity` is the worst status across those N checks (`down` dominates `degraded`). This is the single-incident-per-outage invariant — further bad checks while an incident is open never open a second incident; they may only **escalate** severity (`degraded` -> `down`) on the open incident.
- **Close:** when `consecutiveGood` reaches M and an incident is open, close it (`resolved_at = now`).
- **Degraded vs down:** an incident opened purely by `degraded` checks has `severity = degraded`; if `down` checks arrive while it is open, severity escalates to `down` (recorded on the incident, surfaced as `status.change`). A `degraded`-only incident is real (slow == not healthy) but the public banner distinguishes "degraded performance" from "outage".
- **Flap suppression:** the N/M debounce _is_ the flap suppression — a single failed check (N=3) never opens an incident and a single recovered check (M=2) never closes one. A monitor oscillating up/bad/up/bad never accumulates N consecutive bad, so it never opens; if genuinely failing at the boundary, the incident opens once and stays open until M clean checks, so it does not spawn duplicates. (Exponential flap penalty is a v2 note, not v1.)
- The machine is a **pure reducer** `reduce(state, checkResult) -> { state, effects }` where `effects` is `[]` or `[{ type: 'incident.open' | 'incident.close' | 'severity.escalate', ... }]`. The engine persists incident rows and emits the corresponding domain events from the effects; the reducer touches no IO, so it is exhaustively unit-testable against status sequences with known expected incident counts (success criterion: "N consecutive failures opens exactly one incident, not N").

**Uptime computation (windows 24h / 7d / 30d):**

- **What counts:** uptime% over a window = `(window_seconds - downtime_seconds) / window_seconds`. **Downtime is result-based**, attributed by the duration each result represents (a result "covers" the span until the next result, **capped at the monitor interval** so a long gap does not inflate downtime). `down` counts fully against uptime; **`degraded` counts as 50% against uptime** (constant `DEGRADED_UPTIME_WEIGHT = 0.5`) so slow time is visibly worse than healthy but not as bad as an outage; `up` counts fully toward uptime.
- **Unknown gaps:** a gap longer than `2 * interval` (monitor paused, worker down) is marked `unknown` and **excluded from both numerator and denominator** so restarts do not read as outages. Documented.
- **Partial windows:** a monitor younger than the window is scored only over its observed lifetime (denominator = observed seconds) and the UI labels it. Seeded history (frozen-`now`) fills the window for the demo so first load shows a full 30d.
- **Query strategy (hybrid, ties to ADR-005):** **24h** is computed on the fly from raw `check_results` (cheap — ~1440 rows/day for a 60 s monitor, indexed on `(monitor_id, checked_at)`). **7d / 30d** are computed from the **hourly rollup table** (`check_rollups_hourly`, ADR-005) so the long-window query reads ~168 / ~720 rows instead of tens of thousands. The current open incident's still-accruing downtime is added on top of the rollup so the live number is correct between rollup ticks.

### Consequences

- **Positive.** The pure-reducer state machine is the centrepiece "heavy domain logic" senior signal and is exhaustively unit-testable (every success-criterion invariant maps to a fixture). The N/M debounce gives flap suppression for free. The hybrid uptime query keeps the 30d view cheap on a high-volume table. Degraded-as-50% makes "degraded" meaningful rather than cosmetic.
- **Negative.** Result-based downtime depends on capping a result's coverage at the interval and on the `unknown`-gap exclusion; both are unit-tested but are subtle rules a reviewer should verify. The 7d/30d numbers depend on the rollup job (ADR-005) running; if it lags, the live-incident top-up keeps the _current_ value correct but historical buckets settle slightly late.
- **Follow-up tasks.** `backend-engineer`: Task 5.1 (the reducer + incident persistence + `incident.*` events). ADR-005 must provide `check_rollups_hourly`. `test-engineer`: Task 8.1 (state-machine invariants + uptime% against known-percentage fixtures incl. partial windows and `unknown` gaps). Shared Zod schemas for incident + status live in `src/lib/schemas/` (Task 1.4).

### References

- **PLAN.md** Tasks 0.3, 5.1, 8.1; data-model sketch (`incidents`, `check_results`); success criteria (incident correctness, uptime correctness).
- **ADR-002** (per-check status classification feeding the reducer), **ADR-005** (`check_rollups_hourly` for the 7d/30d path).
- UptimeRobot / BetterStack "confirmation count" model as the industry reference for N/M debounce.

---

## ADR-005: Drizzle data model, indexing, and retention / rollup

**Status:** accepted
**Date:** 2026-06-03

### Context

PLAN.md Task 0.4 deferred ratifying the data model, the time-series indexing, the `check_results` retention / down-sampling posture (the table grows fast — a 60 s monitor is 1440 rows/day, ~43k rows/month per monitor), and the Postgres connection strategy under a separate worker process. ADR-004 already depends on an hourly rollup table; this ADR defines it.

### Options considered

**A — Retention of the high-volume `check_results`:**

- A1: **Keep raw rows for a bounded window (35 days) + hourly rollup table for the long-window charts/uptime; a BullMQ repeatable GC job prunes raw rows past 35d and a rollup job aggregates.** **Picked.** 35d covers the 30d uptime view with margin; rollups serve 7d/30d cheaply (ADR-004) and keep the 30d chart off raw rows.
- A2: Keep all raw forever. Rejected: unbounded growth on a long-running demo (AGENT_NOTES explicitly forbids shipping without a retention call).
- A3: Postgres partitioning by time + drop old partitions. Rejected for v1 as over-engineering at portfolio scale; noted as the v2 scaling path. A simple indexed batched `DELETE` GC sweep suffices here.

**B — Rollup granularity:**

- B1: **Hourly rollups for 7d/30d charts + uptime; daily rollups for >30d deferred to v2.** **Picked** — hourly gives 720 buckets for 30d, smooth enough for the detail chart and cheap.
- B2: Only daily. Rejected: too coarse for the 7d response-time chart.

**C — Worker DB connection strategy:**

- C1: **Separate small `postgres-js` pool per process (API ~10, worker ~5), both pointing at the same Fly Postgres.** **Picked.** The split processes (ADR-006) each own their pool; pools are sized small to stay under Postgres `max_connections` on a small instance.
- C2: A shared pgBouncer. Rejected as unnecessary at this scale; noted as the v2 path if connection count grew.

### Decision

**Tables (Drizzle, Postgres), refining the PLAN.md sketch:**

- **users / sessions / accounts / verifications** — owned by **better-auth** (its schema; do not hand-roll). Monitors FK to `users.id`.
- **monitors** — `id` (uuid pk), `user_id` (fk -> users, cascade delete), `name`, `target_url`, `method`, `interval_seconds`, `timeout_ms`, `expected_status` (int or small range), `expected_keyword` (nullable), `degraded_threshold_ms`, `failure_threshold` (default 3), `recovery_threshold` (default 2), `is_public` (bool), `is_paused` (bool), `created_at`, `updated_at`. Index `(user_id)`.
- **check_results** — `id` (bigserial pk), `monitor_id` (fk -> monitors, cascade delete), `checked_at` (timestamptz), `status` (enum `up|degraded|down`), `status_code` (smallint null), `response_time_ms` (int null), `error` (enum null, the normalised class from ADR-002). **Critical index: `(monitor_id, checked_at DESC)`** — serves both the recent-checks read and the 24h uptime/window scan. High-volume; retained 35 days.
- **check_rollups_hourly** — `monitor_id` (fk), `bucket_start` (timestamptz, hour-truncated), `up_count`, `degraded_count`, `down_count`, `unknown_count`, `avg_response_time_ms`, `p95_response_time_ms`, `min_ms`, `max_ms`. **PK `(monitor_id, bucket_start)`.** Serves 7d/30d uptime (ADR-004) and the long-window response-time chart. Retained 400 days (cheap — 24 rows/day/monitor).
- **incidents** — `id` (uuid pk), `monitor_id` (fk, cascade), `status` (enum `open|resolved`), `severity` (enum `degraded|down`), `started_at`, `resolved_at` (null while open), `cause` (text snapshot of the failing condition). **Partial unique index `(monitor_id) WHERE status = 'open'`** — enforces single-open-incident-per-monitor (ADR-004) at the DB, not just in app code. Index `(monitor_id, started_at DESC)` for the history list.
- **alert_channels** — `id` (uuid pk), `user_id` (fk, cascade), `type` (enum `webhook|email`), `target`, `secret` (webhook HMAC key; nullable for email), `is_enabled`.
- **alert_deliveries** — `id` (uuid pk), `incident_id` (fk, cascade), `alert_channel_id` (fk, cascade), `transition` (enum `open|close`), `delivered_at`, `status` (enum `sent|failed`), `response_code` (smallint null). **Unique `(incident_id, alert_channel_id, transition)`** — the DB-level de-dup that guarantees one alert per (incident, channel, transition) (PLAN.md Task 5.2).
- **public_status_pages** — `id` (uuid pk), `user_id` (fk, cascade), `slug` (unique), `title`, `description`. Plus a join **public_status_page_monitors** `(status_page_id fk, monitor_id fk)`, PK both — which monitors appear on which page. (v1 ships one page, but the join keeps it clean and v2-ready.) The public stream (ADR-003) and public read endpoints resolve the page's monitor set through this join.

**Alert channel split (owner-confirmed) — one dispatch interface, two implementations.** The alerts module defines a single `AlertDispatcher` interface (`dispatch(channel, incident, transition) -> DeliveryResult`). **Webhook is REAL:** the payload is JSON, **HMAC-SHA256 signed** with the channel's `secret` (header `X-Pulse-Signature: sha256=<hex>` over the raw body, plus an `X-Pulse-Timestamp` to bound replay), Slack/Discord-incoming-webhook-compatible shape. **Email is MOCKED:** the email implementation satisfies the same interface but does not open an SMTP connection — it records an `alert_deliveries` row (`status = sent`) and logs the rendered message, documented honestly in the README as mocked (no SMTP dependency on the demo host). Both go through the same de-dup unique constraint above, so the dispatch path is uniform and a real SMTP transport could be dropped in later without touching the incident engine.

**Retention / rollup mechanics:**

- A **BullMQ repeatable rollup job** runs **every 5 minutes**, aggregating the just-closed/closing hour buckets from `check_results` into `check_rollups_hourly` (idempotent upsert on `(monitor_id, bucket_start)`, so a re-run never double-counts).
- A **BullMQ repeatable GC sweep** runs **hourly**, batched-`DELETE`-ing `check_results` rows older than **35 days** (indexed, batched to avoid a long lock) and `check_rollups_hourly` rows older than 400 days. This is the bounded-growth guarantee AGENT_NOTES demands.
- Both jobs register alongside the probe schedules in the worker's `OnModuleInit`.

**Connection strategy:** each process (`api`, `worker`) owns a small `postgres-js` pool (API ~10, worker ~5) against the same Fly Postgres, sized to stay under `max_connections`. The Drizzle client is a Nest provider injected per module.

### Consequences

- **Positive.** The `(monitor_id, checked_at DESC)` index makes the hot read paths cheap; the partial-unique-open-incident index and the alert-delivery unique constraint push two correctness invariants (single open incident, alert de-dup) down to the DB so app bugs cannot violate them. 35-day raw retention + hourly rollups bound Postgres growth and keep the 30d chart fast. The single `AlertDispatcher` interface keeps the real-webhook / mocked-email split honest and swappable. The `public_status_page_monitors` join keeps the public surface's monitor set explicit and v2-ready.
- **Negative.** The rollup table is derived state that must be kept consistent (idempotent upsert + the live-incident top-up in ADR-004 cover the lag). 35-day raw retention means per-check forensics older than 35 days are gone — acceptable for a demo, noted as a v2 partitioning extension. Two pools against one small Postgres requires watching `max_connections` (sized conservatively).
- **Follow-up tasks.** `backend-engineer`: Task 1.2 (schema barrel + migrations + the indexes/constraints above + Drizzle provider), the rollup + GC repeatable jobs (alongside Task 2.2), Task 5.2 (the `AlertDispatcher` interface + HMAC webhook + mocked email), Task 6.4 (seed honoring frozen-`now`). The retention window (35d raw / 400d rollup), the two derived correctness indexes, and the real-webhook/mocked-email dispatch split go to AGENT_NOTES.

### References

- **PLAN.md** Tasks 0.4, 1.2, 5.2, 6.4; data-model sketch; AGENT_NOTES "check_results retention / down-sampling is unpinned" and "Email alert channel: live or mocked?".
- **ADR-004** (uptime reads rollups for 7d/30d), **ADR-002** (the `error` normalised-class enum, the probe write path), **ADR-006** (split processes -> two pools).
- **better-auth** Drizzle schema; **Drizzle** enums, partial / unique indexes, `postgres-js` pooling.

---

## ADR-006: Deploy topology on Fly.io

**Status:** accepted
**Date:** 2026-06-03

### Context

PLAN.md Task 0.5 deferred the Fly topology: how the NestJS API/SSE server and the BullMQ worker map onto processes/machines, where the Next frontend lives, which Redis and which Postgres, how SSE survives the Fly edge, the demo-incident mechanism, and seed-vs-live coexistence — on a small budget, single region. AGENT_NOTES flags the split-vs-single-process question as coupled to ADR-002/003 (decide together), and the wow moment must not cold-start in front of a recruiter.

### Options considered

**A — Process model for the NestJS app:**

- A1: **Split: a `web` process (HTTP + SSE) and a `worker` process (BullMQ), two Fly `[processes]` from one image, the same NestJS codebase booting different modules.** **Picked.** SSE connections are long-lived and I/O-bound; the worker is CPU-/network-bursty running probes. Splitting keeps a burst of probes from starving SSE responsiveness, is the production-faithful shape (the stronger senior signal), and the ADR-003 Redis Pub/Sub bridge already makes the split clean (worker publishes to `pulse:events`, web subscribes). Two processes from one image add deploy surface but near-zero extra build complexity (Fly `[processes]` in one `fly.toml`).
- A2: Single process (API + worker in one). Simpler/cheaper but couples SSE latency to probe bursts and is the weaker signal; rejected, though it remains the trivial fallback if the budget forced it.

**B — The Next frontend:**

- B1: **Separate Fly app (`pulse-web`) that proxies/calls the NestJS API**, mirroring the meld topology the portfolio already runs. **Picked** — keeps the Next app and the API independently deployable, lets the public status page be SSR/edge-cacheable for Lighthouse without coupling to the API machine, and reuses the meld proxy precedent (including the meld catch-all transport-encoding-header fix already in repo history).
- B2: Serve Next from within NestJS. Rejected: muddies the two runtimes and the Lighthouse-on-public-page story.

**C — Redis:**

- C1: **Upstash Redis (via Fly's Upstash integration), single region `fra`.** **Picked** — managed, no machine to babysit, generous small tier, and it backs both BullMQ and the ADR-003 Pub/Sub bridge. Pin `fra` to co-locate with the app/db (Pub/Sub + BullMQ latency matters).
- C2: A self-run Redis Fly Machine. Rejected for v1: one more stateful machine to keep warm and back up for no benefit at this scale; noted as a cost-tuning alternative.

**D — Postgres:**

- D1: **Fly Postgres (a single small Machine, `fra`).** **Picked** — co-located, cheap, sufficient single-region. Both pools (ADR-005) target it.

### Decision

**Topology (all single region `fra`):**

- **`pulse-api` Fly app, two processes from one image:** `web` (NestJS HTTP + the two `@Sse()` routes, the public read endpoints, better-auth) with **`min_machines_running = 1` / `auto_stop = off`** so SSE and the wow moment never cold-start in front of a recruiter (the tape "keep the machine warm" precedent); and `worker` (the BullMQ probe worker + the rollup + GC repeatable jobs), also `min_machines_running = 1` so probes keep running. Same Docker image, process selected by start command.
- **`pulse-web` Fly app:** the Next 15 frontend, proxying API calls to `pulse-api` (meld proxy precedent, including the transport-encoding-header strip in the catch-all). The public status page is SSR and edge-cacheable for Lighthouse >= 95.
- **Redis:** Upstash Redis, `fra` — backs BullMQ and the `pulse:events` Pub/Sub bridge.
- **Postgres:** Fly Postgres, small Machine, `fra`.
- **SSE across the Fly edge:** the 15 s `heartbeat` (ADR-003) keeps connections under the edge idle timeout; the immediate `: connected` comment flushes proxy headers; `auto_stop = off` on `web` prevents a machine-stop mid-stream.

**Demo-incident mechanism (the wow moment, reproducible on demand):** **an owned, always-on "flaky" endpoint controlled by the API** — a route on `pulse-api` (e.g. `GET /demo/flaky`) whose health is toggled by a **Redis-backed flag** (so both the web and worker processes agree). The dashboard "Trigger demo incident" button calls an authenticated `POST /demo/trigger` that flips the flag to "failing" for ~40 s then auto-recovers; the seeded demo monitor (pointing at `https://<pulse-api-host>/demo/flaky`) then **organically** records `down` -> opens an incident -> fires the webhook -> recovers -> auto-closes, all through the **real** probe path. Chosen over "point a monitor at an external failing target" because it stays inside the SSRF allowlist (the host is our own public endpoint, not an internal address), needs no third-party dependency, and exercises the genuine probe/incident/alert pipeline rather than a faked shortcut.

**Seed vs live coexistence on the deployed demo:** the seed job (PLAN.md Task 6.4, `faker.seed(n)`, frozen-`now`) populates historical `check_results` + `check_rollups_hourly` + closed `incidents` so first load is rich across 30d; it runs **once at deploy** (a guarded one-shot, idempotent on a seed-marker row) and writes history **up to `now`**. Live probes then run forward from `now` on their real intervals. The two are distinguished by `checked_at` relative to deploy time and documented in the README as "history is seeded, everything from now is real" — the credibility line AGENT_NOTES insists on.

**Secrets inventory (`.env.example` committed, never `.env`):** `DATABASE_URL` (Fly Postgres), `REDIS_URL` (Upstash), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEBHOOK_SIGNING_KEY` (HMAC for outbound webhook payloads), `DEMO_TRIGGER_ENABLED` (guard the demo route), and the `pulse-web` -> `pulse-api` base URL / internal token. Set via `fly secrets`.

### Consequences

- **Positive.** Split web/worker is production-faithful and protects SSE latency from probe bursts; the ADR-003 Pub/Sub bridge makes it clean and multi-replica-ready. Warm floors (`min_machines_running = 1`, `auto_stop = off`) guarantee the wow moment never cold-starts for a recruiter (the tape lesson). Managed Upstash + Fly Postgres minimise stateful-machine babysitting on a small budget. The owned-flaky-endpoint demo mechanism exercises the real pipeline and stays inside the SSRF allowlist. Seed-once-at-deploy keeps the honest seed/live boundary.
- **Negative.** Two always-on app processes + Postgres + Upstash is the largest deploy surface and cost in the portfolio (ADR-001 already flagged this). Mitigation: smallest viable Fly Machine sizes, single region, Upstash small tier, and `auto_stop = off` scoped only to what must stay warm. Single region means probe latency is `fra`-relative (multi-region probing is explicitly v2). The Redis-backed demo flag is a tiny shared-state coupling between processes — accepted, it is the simplest correct way for web and worker to agree.
- **Follow-up tasks.** `backend-engineer` / `main thread`: Task 9.2 (deploy: `fly.toml` with the two `[processes]` + warm-floor settings, Upstash + Fly Postgres provisioning, the `/demo/flaky` + `/demo/trigger` routes with the Redis flag, the seed-once-at-deploy guard, the secrets inventory) and Task 3.4 (the "Trigger demo incident" UI affordance against `POST /demo/trigger`). The warm-floor requirement, the owned-flaky-endpoint demo mechanism, and the seed-once-at-deploy boundary go to AGENT_NOTES.

### References

- **PLAN.md** Tasks 0.5, 3.4, 6.4, 9.2; AGENT_NOTES "single process vs split web/worker", "demo-incident mechanism", "the probes are REAL".
- **ADR-003** (Redis Pub/Sub bridge enabling the split), **ADR-005** (two pools / Fly Postgres, the rollup + GC jobs the worker runs).
- **meld** repo history — the Next-proxies-API topology and the catch-all transport-encoding-header strip; **tape** repo history — keep-the-Fly-machine-warm (`auto_stop` off, `min_running 1`).
- **Fly.io** `[processes]`, `min_machines_running`, Upstash Redis integration, Fly Postgres.

---

## ADR-007: The demo-open auth posture (better-auth wired, demo workspace viewable, mutations gated)

**Status:** accepted
**Date:** 2026-06-04

### Context

Phase 6 wires real auth (better-auth) into Pulse. The tension a portfolio demo must resolve: a real product gates the dashboard behind a login, but a portfolio showcase must NOT put a login wall in front of the wow moment — a recruiter arriving from a CV link must see the live board reacting to real probes and be able to fire the demo incident in the first 10 seconds, with zero friction. Equally, the showcase must demonstrate that auth genuinely works (a real user gets their OWN private workspace), and the deployed demo must be trashable-proof (an anonymous visitor must not be able to delete the seeded demo monitors or spray alert channels). ADR-001 fixed better-auth; ADR-005/006 left the user table as a `uuid`-PK seam and flagged the Phase-6 reconciliation of better-auth's default TEXT id against the existing `uuid` FKs. This ADR ratifies the exact posture and the FK reconciliation.

### Options considered

**A — The auth posture for the deployed demo:**

- **A1 (picked): demo-open — viewable shared demo workspace, mutations gated.** An UNAUTHENTICATED visitor lands in the SHARED, seeded DEMO workspace's dashboard, fully VIEWABLE: the live board, monitor detail, incidents, and the "Trigger demo incident" button all work without login. MUTATIONS (create/edit/delete monitors + alert channels) require a real signed-in session; an unauthenticated visitor gets a clear `401 authentication_required` ("sign in to manage") from those write endpoints. The demo-incident trigger is allowed unauthenticated (it is safe + it is the wow). A REAL user who signs up gets their OWN private workspace (their monitors / incidents / alerts scoped to their `users.id`).
- **A2: gate the whole dashboard behind login.** Production-faithful but it puts a login wall in front of the wow moment — the exact thing PLAN.md's viewer-1 10-second judgement forbids. Rejected.
- **A3: fully open (no auth at all).** Trashable — an anonymous visitor could delete the seeded demo monitors and break the demo for the next viewer; and it would not demonstrate that auth works (a §4 + success-criterion requirement). Rejected.

**B — The owner-resolution boundary shape:**

- **B1 (picked): one crisp seam — `CurrentOwnerService`.** A single service turns a request into an owner: a valid session -> that user (`kind: 'authenticated'`); no session -> the seeded demo owner (`kind: 'demo'`). Reads call `resolveOwnerUserId(req)` (either kind); writes call `requireUserId(req)` which rejects `demo` with a 401. The distinction lives in ONE place, not scattered `if (session)` branches across every controller.
- **B2: a Nest guard on each write route + ad-hoc session reads elsewhere.** More idiomatic-Nest but it splits the demo-fallback logic (reads) from the gate (writes) across two mechanisms; the single seam is clearer and is the brief's "crisp boundary, not scattered ifs" requirement. Rejected (the seam internally throws the same `UnauthorizedException` a guard would).

**C — The FK reconciliation (the Phase-1 flag: better-auth's default id is TEXT; monitors.user_id is UUID):**

- **C1 (picked): keep `users.id` UUID, configure better-auth to emit UUIDs onto the existing `users` table.** `advanced.database.generateId` returns `randomUUID()` and the `user` model is mapped onto the existing `users` table (`schema: { user: users }`). The Phase-6 migration is purely ADDITIVE — it adds the columns better-auth needs (`email_verified`, `image`, `updated_at`) to `users` and creates `session` / `account` / `verification`; it NEVER repoints an FK. Every existing `uuid` FK (`monitors.user_id`, `alert_channels.user_id`, `public_status_pages.user_id`) keeps working untouched.
- **C2: adopt better-auth's default TEXT id and repoint every FK uuid->text.** A destructive, multi-table migration that rewrites every FK column type and risks the existing seeded data; pure downside vs C1. Rejected.

### Decision

**Demo-open posture (A1).** better-auth is fully wired (email+password sign up / sign in / sign out / get session) under `/api/auth/*`. The deployed demo stays open: an unauthenticated visitor reads the shared seeded demo workspace; mutations require a real session. A real user gets their own private workspace, scoped by `users.id`.

**The crisp boundary (B1).** `CurrentOwnerService` (in the `@Global` AuthModule) is the single owner-resolution seam. It replaces the Phase-1 `resolveOwnerUserId(db)` call sites and the Phase-3 `getCurrentUserId` stream seam:

- `resolveOwnerUserId(req)` — READS. Session -> that user; no session -> the seeded demo owner. Used by `GET /monitors`, `/monitors/:id`, `/monitors/:id/{uptime,series,history,checks}`, `/incidents`, `/monitors/:id/incidents`, `GET /alert-channels`, and the dashboard SSE stream (`GET /api/stream`, the cookie travels via `EventSource(withCredentials)`).
- `requireUserId(req)` — WRITES. Returns the session user OR throws `401 { error: 'authentication_required', message: 'Sign in to manage...' }` for the demo fallback. Used by `POST/PATCH/DELETE /monitors` and `POST/DELETE /alert-channels`.
- The demo-incident trigger (`POST /demo/trigger`, `GET /demo/flaky`, `GET /demo/status`) does NOT call the seam — it is allowed unauthenticated (safe + the wow).
- The public read surface (`GET /public/:slug`) and the public SSE stream are unauthenticated by design (ADR-003) and expose only the redacted subset.

**The FK reconciliation (C1).** `users.id` stays `uuid`; `advanced.database.generateId` makes better-auth emit UUIDs; the `user` model maps onto `users`. Migration `0002_*` is additive (3 columns on `users` + the `session`/`account`/`verification` tables, their `user_id` FK -> `users.id` uuid, cascade). No FK is repointed.

**Cookie posture (dev split-origin 3081->3080 vs prod single-origin proxy).** `SameSite=Lax`, `HttpOnly`, `Secure` in production only. DEV: the web (:3081) and API (:3080) are different origins, so the session cookie travels via CORS `credentials: true` (main.ts) + better-auth `trustedOrigins` (= `CORS_ORIGINS`); the dashboard `fetch`/`EventSource` use `credentials:'include'`/`withCredentials:true`. PROD: the pulse-web Next app reverse-proxies pulse-api (ADR-006), so the browser sees ONE origin — the cookie is first-party + `Secure`, and the SSE `EventSource` (which can only send a cookie, not a header) is authenticated with no special handling. This is exactly the SSE-over-cookie argument ADR-001/003 made.

**Rate limiting (§4 security bar).** The auth endpoints get better-auth's built-in brute-force limiter (enabled explicitly; `/sign-in/email` and `/sign-up/email` tightened to 5/min). It keys on the client IP, so `trust proxy` is set on Express and the AuthController injects `x-forwarded-for` from the connecting socket in dev (better-auth SKIPS rate limiting when it cannot determine an IP — the guard would silently no-op otherwise). The public read endpoint (`/public/:slug`) gets a small in-memory fixed-window `RateLimitGuard` (60/min/IP).

### Consequences

- **Positive.** The wow moment has no login wall (the demo workspace is fully viewable + the demo trigger fires unauthenticated), yet auth genuinely works (a real user gets a private, isolated workspace — proven live: an authed user sees only their monitor, the demo workspace does not, the SSE stream scopes per-user) and the demo is trashable-proof (writes 401 the demo fallback). The single `CurrentOwnerService` seam keeps the demo-vs-authed distinction in one auditable place. The additive FK reconciliation means zero risk to the existing schema/data. The cookie posture works for the SSE `EventSource` with no second credential.
- **Negative.** The demo workspace is shared mutable-by-the-seed-only state — an authed user cannot "claim" it; they get a fresh empty workspace (acceptable: the demo richness is seeded, a real user builds their own). The in-memory rate-limit stores (better-auth's + the public guard's) are per-web-machine; multi-replica would need a Redis-backed store (a one-line swap, the same posture ADR-003 took for the SSE bridge). The CSRF Origin check better-auth enforces on POST means a programmatic client must send an `Origin` header (a browser always does) — documented for anyone scripting against the auth API.
- **Follow-up tasks.** `frontend-engineer` Phase 6: the sign-in/sign-up UI (`/api/auth/sign-in/email` etc., `credentials:'include'`), surfacing the `401 authentication_required` as a tasteful "sign in to manage" prompt on the gated write affordances (the demo visitor sees the board but the create/edit/delete buttons prompt), the public `/status/[slug]` page consuming `GET /public/:slug` (SSR, SEO: OG + JSON-LD + sitemap + robots, Lighthouse >= 95), and flipping the nav's "Status page" / "Settings" off `comingSoon`. `reviewer`: the owner seam (the read-vs-write split, that no write path bypasses `requireUserId`), the FK reconciliation migration, the cookie/CORS posture, the public redaction chokepoint, and the two rate limiters.

### References

- **PLAN.md** Tasks 6.1–6.3; the wow-moment 10-second viewer-1 judgement; success criteria (auth boundary holds + E2E-tested, public page exposes only public monitors, rate limiting on auth + public endpoints).
- **ADR-005** (the `users` uuid seam + the Phase-6 reconciliation flag), **ADR-006** (the single-origin reverse-proxy that makes the SSE cookie first-party + the secrets inventory), **ADR-003** (the SSE-over-cookie auth + the public redaction the public read surface mirrors).
- **better-auth** — `betterAuth()` + `drizzleAdapter`, `advanced.database.generateId` (UUID), `advanced.ipAddress.ipAddressHeaders`, the built-in `rateLimit`, `fromNodeHeaders` / the Web-Fetch `handler`.
- **AGENT_NOTES.md** — "users table is a DOCUMENTED SEAM ... Phase 6 reconciliation flag", the demo-user stream seam (`getCurrentUserId`, now superseded by `CurrentOwnerService`), the dev-vs-prod cookie/CORS note.

---
