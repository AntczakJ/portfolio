# meld — Phase 4.2 review (reviewer subagent)

Date: 2026-05-31
Verdict: **GREEN — ship Phase 5 + 6**
Sanity check: server lint / typecheck / build / test = clean / 86 pass.
Web lint / typecheck / build / test = clean / 141 pass. Production bundle
verified: zero matches for `meld-dev-conflict-viz`, `meld-engine`,
`meld-presence`, `meld-awareness`, `meld-connection` in `.next/static/chunks`.

## 1. Test regression triage

**Outcome: no regression. The Phase 3.4 report flagged 135/141, citing a
`roundedRectPath / quadraticCurveTo` failure in `painters/cursors.ts`. Live
disk state is 141/141.** Phase 3.3's `canvas-mock.ts` extension (lines 43-46
of `web/src/lib/canvas/__tests__/canvas-mock.ts`) already lists
`quadraticCurveTo`, `bezierCurveTo`, `ellipse`, and `setLineDash` as
stubbed methods. The painter at `painters/cursors.ts:244-250` uses
`quadraticCurveTo` for the rounded pill — covered by the mock. Either
the Phase 3.4 report captured an intermediate failed run before the
parallel-edit landed, or the test runner was invoked against a stale
checkout. **No fix required.**

## 2. SERVER findings

Clean. Spot-checked:

- `server/src/server.ts` Hono app construction + per-app
  `Hono<{ Variables: MeldVariables }>` generic + middleware order
  (cookie middleware first per ADR-005).
- `server/src/lib/ws/server.ts` Hocuspocus 4.1 bootstrap + extension
  order: `meld-onconnect-stub` (priority 0) → `sessionContextExtension`
  (priority 10) → `meld-welcome-emit` (priority 50) →
  `rateLimitExtension` (priority 100) → `storageExtension`
  (priority 1000). Order matches the documented intent.
- `server/src/lib/ws/storage.ts` hybrid ops-log + snapshot transaction
  + READ COMMITTED reasoning is correct: `boards` UPSERT then
  `board_ops` DELETE inside one `db.transaction(...)`, encode-outside-
  transaction so the row lock is not held across the CPU pass.
- `server/src/lib/ws/rate-limit.ts` token bucket 100 cap / 100 tokens-
  per-second, lazy refill at access time keyed by `socketId`, freed
  on `onDisconnect`. ADR-006 spec matched.
- `server/src/lib/ingest/retention-scheduler.ts` daily 03:00 UTC
  cadence with `computeNext3amUtc` pure helper + boot-sweep then
  reschedule, single-transaction SELECT-broadcast-DELETE pattern.
  Per-connection broadcast failure logged but does not abort the
  sweep — correct.
- `server/src/lib/ingest/compaction-sweep.ts` 6 h rolling backstop
  for rooms above 100-ops backlog firing `storeDocumentHooks(...,
  true)`.
- `server/src/lib/rate-limit/ip-rate-limit.ts` 30/h/IP fixed-window
  per ADR-001 / Task 1.6 spec, `extractClientIp` reads
  `X-Forwarded-For` first segment per RFC 7239.
- Drizzle migrations `drizzle/0000_*.sql` + `0001_*.sql`: `boards`
  has the `last_active_at` btree index for retention; `board_ops`
  has unique `(board_id, op_seq)` and a sibling non-unique index +
  `ON DELETE CASCADE` on the FK. The 1000-board scale of v1 is
  comfortable under these indexes.

## 3. CLIENT findings

Clean. Spot-checked:

- `web/src/components/board/board-canvas-host.tsx` `'use client'` is
  required (it constructs the imperative HocuspocusProvider + engine
  with refs). Cleanup order matches the documented contract: stop
  engine, destroy provider, clear refs. AwarenessProvider wraps the
  `<main>` region so Phase 3.3's cursors see the awareness through
  context. ResizeObserver + matchMedia `(resolution: ...dppx)` for
  DPR change — both teardown paths present. Reduced-motion-gated
  crossfade with the dip → restore via `setTimeout(100ms)` clean up
  on dependency change.
- `web/src/lib/canvas/engine.ts` subscribe-once contract upheld:
  one `shapesMap.observe`, one `awareness.on('change')`, one
  `themeBridge.subscribe`. `start()` throws on re-entry. The dirty
  flag is a boolean — multiple observer fires within one frame
  collapse to one paint. Critical-damped lerp at `tau = 30 ms` is
  the spec.
- `web/src/lib/yjs/provider.ts` HocuspocusProvider (not raw
  `WebsocketProvider`) per ADR-002 + ADR-008. Cookie attaches
  natively to the WS upgrade. Welcome TEXT-frame discrimination
  via `typeof event.data === 'string'`. `requireAwareness` narrows
  the framework's `Awareness | null` to non-null.
- `web/src/lib/yjs/use-connection-status.ts` 1500 ms debounce on
  `provider.status === 'disconnected'` + `navigator.onLine === false`
  short-circuit per ADR-009. Hook handles null provider returning
  `'reconnecting'`. Effect cleanup tears down both listeners + the
  pending timer.
- `web/src/components/board/board-pointer-overlay.tsx` 30 ms cursor
  throttle via `CURSOR_WRITE_THROTTLE_MS`, `pointerleave` writes
  `null` to awareness, pointerenter implicitly resets via the
  pre-write throttle reset on the cleanup path.
- `web/src/components/chrome/connection-banner.tsx` + `offline-aria-
  live-region.tsx` copy is verbatim per ADR-009 — banner reads
  `"Offline — your edits will sync when you reconnect"`, aria-live
  region cycles through the three canonical strings with the
  singular/plural toggle on `incomingShapeCount === 1`. Reduced-
  motion fires `duration: 0` on banner Motion sites.
- Dev strip verified: production build chunks contain zero
  occurrences of the five dev literals.

## 4. ADR compliance

| ADR | Decision | Load-bearing line in code | Status |
|-----|----------|---------------------------|--------|
| 001 | Hono control plane | `server/src/server.ts:143` `new Hono<{ Variables: MeldVariables }>()` | OK |
| 002 | Hocuspocus on shared http.Server | `server/src/server.ts:331` `meldWs.attach(httpServer)` + `server/src/lib/ws/server.ts:507` `'upgrade'` handler | OK |
| 003 | hybrid ops+snapshot | `server/src/lib/ws/storage.ts:367-429` transaction body | OK |
| 004 | TEXT control discrimination | `server/src/lib/ws/welcome.ts:201` `webSocket.send(JSON.stringify(payload))` + `web/src/lib/yjs/provider.ts` (`handleProviderMessage`) | OK |
| 005 | cookie + 8-slot wheel + 128 emoji | `server/src/lib/session/cookie.ts:202-208` setCookie attrs + `emoji-names.ts` 128-entry array + `AWARENESS_WHEEL` 8 slots | OK |
| 006 | rate limit + retention | `server/src/lib/ws/rate-limit.ts:65-67` constants + `retention-scheduler.ts:97-120` `computeNext3amUtc` | OK |
| 007 | Phase 5 E2E plan | Documented in `DECISIONS.md` ADR-007 — implementation deferred per scope | DEFERRED (planned) |
| 008 | two-canvas + observer + dev strip | `web/src/lib/canvas/engine.ts:359-394` subscribe-once block + `board-canvas-host.tsx:91` conditional import + `board-canvas-host.tsx:389-391` JSX gate | OK |
| 009 | offline UX contract | `web/src/lib/yjs/use-connection-status.ts:43` `DISCONNECT_DEBOUNCE_MS = 1500` + `connection-banner.tsx:40` `BANNER_COPY` verbatim + `offline-aria-live-region.tsx:43-45` canonical strings | OK |

All nine ADRs implemented or correctly deferred. No drift detected.

## 5. SECURITY findings

| Severity | Finding | File / line | Remediation |
|----------|---------|-------------|-------------|
| medium | No CSP, no `Strict-Transport-Security`, no `X-Content-Type-Options`, no `Referrer-Policy` headers on the Next.js side or in middleware. The web app ships nothing in `headers()` config. | `web/next.config.ts` | Add a `headers()` block returning at minimum `Content-Security-Policy`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Phase 6 deploy-prep is the natural owner. |
| info | `HttpOnly: false` on the session cookie is intentional per ADR-005 to support first-paint identity card. Documented in the cookie middleware top-of-file comment block (`cookie.ts:14-20`). | `server/src/lib/session/cookie.ts:202-208` | None — rationale is captured. |
| info | The `[meld-server] countBoards failed` log path (`server.ts:129`) writes errors raw. No PII risk because the err is internal. | `server.ts:129` | None. |

Verified clean:

- WS upgrade has no token in URL; cookie attaches natively via the
  browser's WS handshake.
- All HTTP routes use Zod via `zValidator` (verified `boards.ts`,
  the session POST route in `server.ts:243-283`, and the path-param
  schema on `GET /api/boards/:boardId`).
- WS control frames are validated through `wsControlFrameSchema`
  before send (welcome + board-deleted + overrun all parse via
  `.parse(...)` before `webSocket.send`).
- Per-IP HTTP rate limit at 30/h + per-socket WS token-bucket at
  100/s — both wired.
- No `dangerouslySetInnerHTML` anywhere in the codebase. Shape text
  is rendered via `ctx.fillText` on Canvas2D, never via React HTML
  injection.
- No `as any`, no `@ts-ignore`, no `@ts-expect-error` anywhere in
  `server/src` or `web/src`.
- No raw `localStorage` reads in production code — only Zustand
  `persist` middleware (and the test file under `__tests__`).

## 6. ACCESSIBILITY findings

Clean. Spot-checked:

- `top-bar.tsx:54` `role="banner"`.
- `brand-mark.tsx:24` `aria-label="Meld"`.
- `identity-badge-client.tsx:102` + `:130` `aria-label` with
  verbatim ADR copy `"Your session identity: ${emojiName}"`.
- `connection-banner.tsx:68-69` `role="status"` + `aria-live="polite"`.
- `offline-aria-live-region.tsx:93` `role="status"` + `aria-live="
  assertive"` + `aria-atomic="true"` + `sr-only`.
- `board-canvas-host.tsx:345-346` shape canvas `role="img"` +
  `aria-label`; cursor canvas (`:353`) `aria-hidden="true"`.
- `board-toolbar.tsx:141-143` `role="toolbar"` + `aria-label="
  Drawing tools"` + `aria-orientation="horizontal"`; each button
  carries `aria-label="${label} (${shortcut})"` + `aria-pressed`.
- `theme-toggle.tsx:94` `aria-label` recomputed per current theme.
- Reduced-motion: ConnectionBanner uses `useReducedMotion()`
  (`:44`) to flip both enter and exit transitions to `duration: 0`.
  Shape-canvas crossfade gate in `board-canvas-host.tsx:294`
  short-circuits on reduced-motion.

Known gap (logged, not blocking):

- The Canvas2D shape canvas does not yet have the parallel hidden
  DOM proxy tree for keyboard navigation. This is **explicitly
  deferred to Phase 3.2b** per ADR-008's documented accessibility
  seam comment block. The role="img" + aria-label gives screen
  readers a coherent first-arrival announcement; full keyboard
  reach lands in Phase 3.2b.

## 7. PERFORMANCE findings

Clean. Spot-checked:

- `/board/[boardId]` First Load JS = **258 kB** (route chunk 81.4 kB).
  Tape's comparable board route is in a similar envelope — yjs +
  hocuspocus-provider + motion + react-query dominate the budget,
  which matches the local-first stack's documented cost. No
  anomalous bloat.
- Subscribe-once contract: no per-frame `getComputedStyle` (theme
  bridge caches on `MutationObserver` flip); no per-frame regex
  (no regex in the rAF path); no per-frame `JSON.parse` (welcome
  parsing is event-driven inside `handleProviderMessage`).
- Paint cost telemetry counter is wired (`engine.ts:198-202`
  `LayerMetrics`) and gated `NODE_ENV === 'development'` (`:641`,
  `:728`). The dev log `[meld-engine]` literal is stripped from
  production chunks — verified by the grep above.
- The engine's `#tick` advance-then-paint ordering matches the
  documented contract; `motionStillActive` keeps the cursor canvas
  dirty across frames while peers are still settling, then idles.

## 8. CONVENTIONS findings

Clean.

- File naming: all kebab-case (verified `server/src/lib/*` and
  `web/src/components/**/*`); PascalCase component exports (`<TopBar />`,
  `<IdentityBadge />`, `<BoardCanvasHost />`).
- `'use client'` directives reviewed: 25 files marked, every one
  justified (provider construction, stores, hooks, interactive
  chrome). No accidental client component in the layout.
- Tailwind v4 conventions: no inline `style={...}` for tokenised
  colors anywhere; CSS-variable references like `bg-(--color-bg)`
  used throughout.
- No emojis in source code anywhere (the 128-emoji whitelist for
  awareness identity is intentionally a wire-only feature — the
  array stores codepoint strings, not literal emoji glyphs in
  source — verified by reading the AGENT_NOTES gotcha).
- Conventional Commits format on tape's recent log; meld has not
  been committed yet (entire `projects/meld/` is untracked per
  `git status`). The first meld commit needs to land scope
  `feat(meld)`. **Logged for the doc-writer / commit step**, not
  a blocker for this review.

## 9. ANTI-PATTERNS findings

Zero matches for: `as any`, `@ts-ignore`, `@ts-expect-error`,
`dangerouslySetInnerHTML`, raw `localStorage.` in non-test code,
`TODO`/`FIXME`/`XXX` in source. Console logs are either dev-gated
(`process.env.NODE_ENV === 'development'`) or structured server
boot/shutdown logs prefixed with `[meld-*]` for grep-ability.

## 10. Naming nit (info)

`ui-store.ts:84` declares `lastReconcileMs: number | null` with
a docstring that says "count of shapes that materialised". The
field IS the count (consumed correctly by
`offline-aria-live-region.tsx:80`), but the `Ms` suffix reads as
milliseconds. Rename to `lastReconcileShapeCount` (no behavioural
change) — queued for Phase 5 / Phase 6 along with the doc pass.
**Not blocking.**

---

# Punch list

## Blocks deploy

None.

## Should fix before deploy (queue for Phase 5 / 6)

1. **Add security headers in `web/next.config.ts`** — at minimum
   CSP + HSTS + `X-Content-Type-Options` + `Referrer-Policy`. Phase 6
   deploy-prep is the natural owner; document in DEPLOY.md.
2. **Rename `lastReconcileMs` → `lastReconcileShapeCount`** in
   `ui-store.ts` and the two consumers. Pure rename, no behavioural
   change.
3. **First meld commit** under `feat(meld)` scope; the entire
   project is currently untracked.

## Nits (defer if cheap)

None.

---

# Phase 4.2 verdict

**GREEN — ship Phase 5 (E2E) + Phase 6 (deploy).**

Eight categories all clean. One medium security finding (missing
security headers) is queue-able into Phase 6 deploy-prep — not a
blocker for Phase 5 (E2E harness setup against the live demo).
Test triage closed the Phase 3.4 false alarm. No ADR drift. No
architectural rework. The codebase is shippable.

Next handoff:

- **Phase 5: test-engineer.** Implement the ADR-007 Playwright
  deploy-verification harness (nine v1 test cases). Use this review
  as the surface map.
- **Phase 6: doc-writer.** Author `README.md` + `CHANGELOG.md` +
  `DEPLOY.md` for the Fly.io ship per ADR-006. Apply the three
  queued items above as the deploy-prep checklist.
