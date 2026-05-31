# Screenshot capture

How to produce the three PNGs the project README references. Owner-side task — the doc-writer subagent cannot drive a browser, so this file is the runbook.

## Prep

1. Bring up the dev stack per [`../README.md`](../README.md) Run locally:
   - Docker Postgres on port 5435.
   - `pnpm -F tape-server dev` on `http://localhost:3001`.
   - `pnpm -F tape-web dev` on `http://localhost:3000` (will fall back to 3002 if 3000/3001 are occupied).
2. Open the URL the Next dev server actually printed — on the owner's machine that is usually `http://localhost:3002` because 3000 and 3001 are typically in use.
3. Wait approximately **2 minutes** for the chart to populate. The synth produces ~5 ticks per second, one `cell.delta` every 500 ms, and one `cell.close` every 60 s — two minutes covers two closed bars and the open bar, which is enough for the canonical chart view.

For deterministic captures (rerunning produces identical bytes), set `WS_SYNTHESIZE=1 WS_SYNTHESIZE_SEED=1 BINANCE_WS_ENABLED=0` on the server. The LCG is seeded so the same boot produces the same tick stream.

## Captures

Three files, exact paths under `projects/tape/docs/screenshots/`. The README references the `.png` names; delete the matching `.png.placeholder` file once the real PNG is committed.

### `home-dark.png`

- Viewport: **1440 x 900**, dark theme (the default).
- Wait until the right edge shows at least two fully closed bars plus the live open bar with cells extending up the price ladder.
- Tape strip on the right edge should have ~30+ rows; cursor not on the chart (clean shot, no tooltip).
- macOS: `Cmd+Shift+4` then `Space`, click the browser content area. Windows: `Win+Shift+S` -> rectangular snip across the entire app viewport (header + chart + footer).
- Save as `projects/tape/docs/screenshots/home-dark.png`.

### `home-light.png`

- Same viewport and chart state as `home-dark.png`.
- Click the **theme toggle** in the footer (bottom-right) until it reads `theme: light`.
- Recapture with the same crop. Save as `projects/tape/docs/screenshots/home-light.png`.

### `mobile-tape.png`

- DevTools (`Ctrl+Shift+I` or `Cmd+Opt+I`) -> **device toolbar** (`Ctrl+Shift+M` or `Cmd+Shift+M`).
- Pick a preset under 768 px — iPhone 12 (390 px) or Pixel 5 (393 px) both work; for the canonical "tightest" shot pick **360 px** custom width.
- Reload (`Ctrl+R`). Below the 768 px breakpoint the footprint chart hides and the layout collapses to **tape-only single column** per PLAN.md success criterion.
- Capture the full mobile viewport (DevTools has a built-in screenshot under the device-toolbar three-dot menu -> `Capture screenshot`).
- Save as `projects/tape/docs/screenshots/mobile-tape.png`.

## After capture

- Commit the three PNGs.
- Delete the matching `.png.placeholder` text files.
- Open `projects/tape/README.md` and uncomment the three `<!-- ![...](...) -->` lines under the Screenshots heading so GitHub renders the images.
- Optionally: post a commit message like `docs(tape): add screenshots [skip ci]`.
