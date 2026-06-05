# Screenshot capture

How the PNGs the README references are produced. Two paths: local synth captures (deterministic data) and a live-deploy capture.

## Committed screenshots

Under `projects/tape/docs/screenshots/`:

- `live-render-3.3-3.4.png` — hero. Full footprint board, dark theme, intra-cell bid/ask histogram + per-bar delta + populated tape strip + CVD pane.
- `live-render-light.png` — the same full board, light theme.
- `deploy-live-board.png` — captured from the live deploy at `tape-demo.fly.dev` (partially filled depending on machine warmth — proves the deploy is real and serving cells).
- `replay-3.6.png` — replay mode scrubbing a recorded session.
- `live-render-mobile.png` — 360 px mobile, tape-only single column below the 768 px breakpoint.
- `dashboard-jetbrains-mono.png`, `chart-jetbrains-mono.png`, `cvd-pane-3.2c.png`, `worker-offline-indicator.png` — supporting / state shots.

## Live-deploy capture (automated)

From `projects/tape/e2e`:

```sh
node capture-live.mjs
```

Drives `https://tape-demo.fly.dev/` headlessly via the e2e workspace's bundled Chromium and writes `docs/screenshots/deploy-live-board.png`. Override with `TAPE_LIVE_URL` and `TAPE_LIVE_WAIT` (ms to wait after load for the board to fill). The board fills from the right as one-minute bars close, so a longer warm machine yields a fuller board.

## Local synth capture (deterministic full board)

1. Bring up the dev stack per [`../README.md`](../README.md) Run locally, using the offline recipe `WORKER_PIPELINE_ENABLED=1 WS_SYNTHESIZE=1 BINANCE_WS_ENABLED=0` on the server.
2. For byte-reproducible captures set `WS_SYNTHESIZE_SEED=1` — the LCG is seeded so the same boot produces the same tick stream.
3. The chart fills from the right as bars close. To produce a full board immediately for a hero shot, inject deterministic data via the dev-only `window.__tapeStore` snapshot hook (the same seam the E2E suite uses).
4. Capture at **1440 x 900** (desktop) and a sub-768 px width (e.g. 360 px) for the mobile tape-only fallback. Toggle theme in the footer for the light counterpart.
