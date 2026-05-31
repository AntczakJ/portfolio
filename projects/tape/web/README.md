# tape — web

Next.js 15 frontend for [Tape](../README.md), a real-time orderflow visualizer for crypto perpetual futures. Footprint chart, CVD sub-pane, live tape ticker, replay scrubber — all rendered against the live Binance Futures WebSocket feed.

This package is the client of the [`tape-server`](../server) Elysia/Bun backend. The two halves are wired with Eden Treaty (added in Task 2.2) for end-to-end type-safe RPC, and a WebSocket stream for the live data path.

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript strict
- Tailwind CSS v4 (CSS-first, `@theme` block, no `tailwind.config.js`)
- next-themes (light + dark + system, attribute=`data-theme`)
- TanStack Query (server state) · Zustand (UI state, added later)
- react-hook-form + Zod (forms, added later)
- Motion (animation chrome, added in Task 2.4 — footprint chart itself is hand-rolled Canvas2D)

See `../DECISIONS.md` for ADR-001 (stack) and ADR-002 (Rust hot-path bridge) and `../PLAN.md` for the full task list.

## Run

```bash
# from the repo root
pnpm install
pnpm -F tape-web dev
```

Open <http://localhost:3000>.

The landing page polls `${NEXT_PUBLIC_API_URL}/api/health` every 15s. With the backend down (the default state in this scaffold) it renders a calm `API offline` indicator instead of an error toast.

## Configuration

Copy `.env.example` to `.env.local` and adjust if your backend lives somewhere other than `localhost:3001`.

```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

`.env` files are never committed.

## Scripts

| Script             | Purpose                                |
| ------------------ | -------------------------------------- |
| `pnpm dev`         | Next dev server on port 3000           |
| `pnpm build`       | Production build                       |
| `pnpm start`       | Production server (after `build`)      |
| `pnpm lint`        | ESLint via `next lint`                 |
| `pnpm typecheck`   | `tsc --noEmit` against `tsconfig.json` |
| `pnpm test`        | Vitest (suites added later)            |

## Theme tokens

Tokens are defined in `src/app/globals.css` inside the Tailwind `@theme` block. The dark palette is canonical; the light palette overrides via `:root[data-theme='light']`. Token names are domain-specific (`--color-bid`, `--color-ask`, `--color-delta-up`, `--color-grid`, `--color-cell-*`, `--color-axis-*`, ...) so the Canvas2D footprint renderer can read them directly via `getComputedStyle` without an indirection layer. Per `docs/conventions.md` § 14, these tokens are not shared with any other portfolio project.

## Theme tokens for Canvas2D

The footprint chart (Phase 3) is Canvas2D — its drawing API takes color strings via `fillStyle` / `strokeStyle` and does not participate in CSS classes. To bridge the gap between the theme tokens declared in `globals.css` and the chart's render loop, this package ships a small bridge module under `src/lib/theme/`:

- **`tokens.ts`** — the tracked tokens tuple (`THEME_TOKENS`), the raw reader (`readThemeTokens()`), the singleton bridge class (`ThemeTokensBridge`), and the SSR-safe lazy accessor (`getThemeTokensBridge()`).
- **`use-theme-tokens.ts`** — a React adapter hook (`useThemeTokens()`) backed by `useSyncExternalStore`. Use this from React components (axis labels, tooltip readouts). Do NOT use it from the chart's per-frame render loop.

The bridge **caches** the current snapshot once, hands the same frozen object reference to every reader, and **only re-reads** when a `MutationObserver` on `documentElement`'s `data-theme` / `class` attribute fires. Subscribers are notified only if a token value actually changed.

Pattern for the Canvas2D consumer (preview, Task 3.1 will wire this):

```ts
const bridge = getThemeTokensBridge();
let tokens = bridge.current();
const unsubscribe = bridge.subscribe((next) => {
  tokens = next;
  scheduleRepaint();
});

// inside the rAF loop:
ctx.fillStyle = tokens['--color-cell-bg-strong'];
ctx.fillRect(x, y, w, h);
```

The React shell never re-renders per frame; the chart pays a single repaint on theme flip.

SSR fallback: `getThemeTokensBridge()` on the server returns a stub whose `current()` yields the dark palette (matching the next-themes `defaultTheme="system"` server-render default). Hydration takes over on the client.

In development, the landing page renders a `<TokenPreview />` block that shows every tracked token as a swatch + value. Toggling the footer `<ThemeToggle />` cycles `system → light → dark` and every swatch re-paints — the bridge in action. The block is gated on `process.env.NODE_ENV === 'development'` and Terser-stripped from production bundles.

## WS streaming

The live data path is a single WebSocket at `${NEXT_PUBLIC_WS_URL}/ws/stream` carrying msgpackr-encoded binary frames per ADR-006. Three modules cooperate:

- **`src/lib/ws/client.ts`** — `WSStreamClient`. Opens the socket, decodes each frame with `msgpackr` (`useRecords: false` to stay spec-compatible with the server), validates with `wsFrameSchema` (re-exported from `tape-server` at the `ws-schemas` subpath), routes to `onSnapshot` / `onFrame` callbacks. Reconnect-with-backoff is split by close code: `4290` (server overrun, transient) starts at 100 ms; any other unexpected close starts at 1 s. Both curves double per attempt, cap at 30 s, apply ±20 % symmetric jitter. Explicit `close(reason)` parks in `idle` and disables auto-reconnect.

- **`src/lib/stores/stream-store.ts`** — `useStreamStore`. Ephemeral Zustand store for live state: `connectionState`, `tickCount`, `lastTickTsMs`, `recentTicks` (ring at 200, matching the WS snapshot tick pin), `openCells` (Map keyed by `${bucketTs}:${priceBucket}`), `closedCells` (ring at 120, matching the WS snapshot cell pin). **No persistence** — closing the tab resets state. The companion `useUiStore` IS persisted; `useStreamStore` is intentionally separate so chrome intent (rail collapse, replay mode) doesn't leak into the live data lane. Per-field selector helpers (`useConnectionState`, `useLastTick`, `useTickCount`, `useRecentTicks`, `useClosedCells`, `useOpenCells`) wrap the store with the right equality functions.

- **`src/lib/ws/provider.tsx`** — `WSStreamProvider`. Client component that constructs one `WSStreamClient` on mount, wires its callbacks to the store actions, calls `close('unmount')` on cleanup. **Mounted via a dynamic import** from `app/page.tsx` (through `components/ws/ws-provider-mount.tsx`) so the ~14 KB `msgpackr` runtime dep and the WS module graph land in their own route chunk rather than the root layout chunk. The `/` page IS the dashboard in v1; if a future non-dashboard route surfaces, move the provider mount to a dedicated dashboard segment layout instead of root.

The StatusBar (`src/components/chrome/status-bar.tsx`) reads `useConnectionState`, `useTickCount`, and `useLastTick` for the live status indicators — colored pip + label, formatted tick count, time-since-last-tick or `'stale'`.

### Smoke testing

Two terminals:

```bash
# Terminal 1 — backend with the synthetic stream gated on:
WS_SYNTHESIZE=1 pnpm -F tape-server dev

# Terminal 2 — web
pnpm -F tape-web dev
```

The synthesizer emits at ~5 ticks/sec, one `cell.delta` every 500 ms, one `cell.close` every 60 s. The status bar should show `connected`, a ticking count incrementing at ~5 Hz, and `Last tick` under 1 s. Stopping the backend flips the pip to `reconnecting`; bringing it back up reconnects within a 100–1100 ms backoff window.

## Accessibility

- Visible focus ring on every interactive element (`:focus-visible` outline using `--color-focus-ring`); no `outline: none` anywhere.
- `prefers-reduced-motion` collapses all CSS animations and transitions to ~0ms — the Motion-based components added in Phase 2.4 also gate on `useReducedMotion()`.
- API status uses `aria-live="polite"`; the footprint cursor readout in Phase 3.5 will mirror to a screen-reader live region as well.

## What is here in v0

Only the scaffold: layout shell, theme provider, query provider, landing hero with status row and theme toggle. The wow moment — Canvas2D footprint chart streaming live BTC-PERP at 60 fps — ships in Phase 3 (see `../PLAN.md`). The landing page is intentionally spare so the chart can land cleanly when it does.

## Reference

- [`../PLAN.md`](../PLAN.md) — full spec and task list
- [`../DECISIONS.md`](../DECISIONS.md) — ADRs
- [`../AGENT_NOTES.md`](../AGENT_NOTES.md) — cross-agent context
- [Root `CLAUDE.md`](../../../CLAUDE.md) and [`docs/conventions.md`](../../../docs/conventions.md) — portfolio-wide rules
