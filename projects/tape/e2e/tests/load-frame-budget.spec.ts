import { expect, test } from '@playwright/test';

import { TapeApp } from '@helpers/tape-app';
import { buildFootprintSnapshot } from '../fixtures/footprint-snapshot';

/**
 * Task 5.5 — client-side frame-budget load test.
 *
 * PLAN.md success criterion: footprint + tape rendering sustains ≥ 60 fps
 * under 200 trades/sec, frame budget ≤ 16.6 ms at the 99th percentile.
 *
 * Methodology (documented HONESTLY — this is the load-bearing part):
 *
 *   1. Seed the deterministic footprint snapshot (so the chart redraws
 *      real cells, not a blank canvas).
 *   2. Drive 200 synthetic `tick` frames/sec through the store's
 *      `ingestFrame` via `__tapeStore` for a fixed window, PACED BY A
 *      `MessageChannel` micro-pump — NOT `requestAnimationFrame` and NOT
 *      `setInterval`. This matters: headless Chrome throttles BOTH rAF
 *      (to ~15 fps when the page is offscreen/unfocused) and background
 *      timers, so an rAF- or interval-paced driver silently under-emits
 *      (measured: ~99/sec instead of 200). A MessageChannel postMessage
 *      loop is not throttled, so we genuinely sustain ~200/sec. Each
 *      injected tick flips the chart engine's `dirty` flag.
 *   3. Measure, in-page:
 *        (a) per-tick `ingestFrame` cost (µs/tick) — the store reducer +
 *            ring-buffer cost that runs on the main thread for every
 *            trade. This is the part of the frame budget the data path
 *            owns, and it is measurable deterministically in headless.
 *        (b) rAF inter-frame deltas — REPORTED ONLY. Under Playwright's
 *            headless Chrome the page's rAF is throttled, so this number
 *            reflects the harness environment, NOT the chart's on-device
 *            paint budget. We log it for transparency but DO NOT gate on
 *            it (gating would assert a headless artefact).
 *
 * THE 16.6 ms p99 frame-budget gate is an ON-DEVICE measurement (Chrome
 * DevTools Performance panel, real display) per the PLAN — it cannot be
 * faithfully reproduced in headless Chrome, where rAF is not vsync-
 * locked. That gate stays a manual DevTools / Lighthouse step (overlaps
 * Task 5.4). This automated test is the REGRESSION guard on the part of
 * the budget that IS measurable headless: the per-tick main-thread cost
 * the renderer pays under 200/sec. A regression that made the store
 * reducer O(n) per tick (e.g. an accidental full-array clone) would blow
 * the per-tick ceiling here and fail loudly.
 */
const TICKS_PER_SEC = 200;
const DURATION_MS = 6_000;

interface LoadResult {
  injectedTicks: number;
  storeTickCount: number;
  effectiveRatePerSec: number;
  ingestPerTickMicros: number;
  ingestTotalMs: number;
  rafFrames: number;
  rafP50: number;
  rafP99: number;
}

test.describe('load test — 200 trades/sec frame budget', () => {
  test('sustains 200 ticks/sec with a tiny per-tick render cost', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    await app.waitForStoreHook();

    // Seed a real footprint so the redraw path has content.
    await app.injectSnapshot(buildFootprintSnapshot());
    await app.expectCanvasPainted();

    const result = await page.evaluate(
      async ({ ticksPerSec, durationMs }): Promise<LoadResult> => {
        const w = window as unknown as {
          __tapeStore?: {
            getState: () => {
              ingestFrame: (frame: unknown) => void;
              tickCount: number;
            };
          };
        };
        const store = w.__tapeStore;
        if (store === undefined) throw new Error('__tapeStore missing');

        const MID = 71_000;
        const ratePerMs = ticksPerSec / 1000;

        // Warm-up: inject a few hundred ticks BEFORE the measured window so
        // the JIT has compiled the reducer hot path and the ring buffers
        // are at steady-state size — otherwise the first measured ticks pay
        // a one-time compile/grow cost that inflates the per-tick average.
        {
          const ingest = store.getState().ingestFrame;
          for (let i = 0; i < 400; i += 1) {
            ingest({
              topic: 'ticks.btc',
              kind: 'tick',
              payload: {
                tsMs: Date.now(),
                price: MID + (i % 40) - 20,
                qty: 0.05,
                aggressor: i % 2 === 0 ? 'buy' : 'sell',
              },
            });
          }
        }

        // --- rAF cadence sampler (reported only). ---
        const rafDeltas: number[] = [];
        let rafPrev = performance.now();
        let rafRunning = true;
        const sampleRaf = (now: number): void => {
          rafDeltas.push(now - rafPrev);
          rafPrev = now;
          if (rafRunning) requestAnimationFrame(sampleRaf);
        };
        requestAnimationFrame((now) => {
          rafPrev = now;
          requestAnimationFrame(sampleRaf);
        });

        // --- 200 ticks/sec driver via an UNTHROTTLED MessageChannel pump. ---
        let injected = 0;
        let seq = 0;
        let ingestTotalMs = 0;
        const start = performance.now();

        const injectOne = (ingest: (f: unknown) => void): void => {
          seq += 1;
          ingest({
            topic: 'ticks.btc',
            kind: 'tick',
            payload: {
              tsMs: Date.now(),
              price: MID + ((seq * 0.5) % 50) - 25,
              qty: 0.05 + (seq % 7) * 0.01,
              aggressor: seq % 2 === 0 ? 'buy' : 'sell',
            },
          });
          injected += 1;
        };

        await new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          const pump = (): void => {
            const elapsed = performance.now() - start;
            // Inject the deficit due since start. The MessageChannel pump
            // fires far faster than the rate, so the deficit per pass is
            // small (1–2 ticks) — no catch-up bursts, an honest steady
            // 200/sec.
            const due = Math.floor(elapsed * ratePerMs);
            const deficit = due - injected;
            if (deficit > 0) {
              const ingest = store.getState().ingestFrame;
              const t0 = performance.now();
              for (let i = 0; i < deficit; i += 1) injectOne(ingest);
              ingestTotalMs += performance.now() - t0;
            }
            if (elapsed >= durationMs) {
              resolve();
              return;
            }
            channel.port2.postMessage(0);
          };
          channel.port1.onmessage = (): void => {
            pump();
          };
          channel.port2.postMessage(0);
        });

        rafRunning = false;
        const deltas = rafDeltas.slice(1);
        const sorted = [...deltas].sort((a, b) => a - b);
        const pct = (arr: number[], p: number): number => {
          if (arr.length === 0) return 0;
          const idx = Math.min(arr.length - 1, Math.floor(arr.length * p));
          return arr[idx] ?? 0;
        };

        return {
          injectedTicks: injected,
          storeTickCount: store.getState().tickCount,
          effectiveRatePerSec: (injected / durationMs) * 1000,
          ingestPerTickMicros:
            injected > 0 ? (ingestTotalMs / injected) * 1000 : 0,
          ingestTotalMs,
          rafFrames: deltas.length,
          rafP50: pct(sorted, 0.5),
          rafP99: pct(sorted, 0.99),
        };
      },
      { ticksPerSec: TICKS_PER_SEC, durationMs: DURATION_MS },
    );

    // --- Report (printed so the test-engineer records real numbers). ---
    const expectedTicks = (TICKS_PER_SEC * DURATION_MS) / 1000;
    console.log('[load-test] 200 ticks/sec frame-budget result');
    console.log(
      `  injected ticks: ${String(result.injectedTicks)} ` +
        `(expected ~${String(expectedTicks)}, ` +
        `effective ${result.effectiveRatePerSec.toFixed(0)}/sec)`,
    );
    console.log(`  store tickCount: ${String(result.storeTickCount)}`);
    console.log(
      `  per-tick ingest cost: ${result.ingestPerTickMicros.toFixed(2)} µs/tick ` +
        `(${result.ingestTotalMs.toFixed(1)} ms total over ` +
        `${String(result.injectedTicks)} ticks)`,
    );
    console.log(
      `  [reported only, headless-throttled] rAF inter-frame ms ` +
        `p50=${result.rafP50.toFixed(1)} p99=${result.rafP99.toFixed(1)} ` +
        `over ${String(result.rafFrames)} frames`,
    );

    // --- Assertions (only on what is meaningful in headless). ---
    // 1. The MessageChannel pump genuinely sustained ~200/sec (within
    //    15%). This proves the driver is not throttled like rAF/interval.
    expect(result.effectiveRatePerSec).toBeGreaterThan(TICKS_PER_SEC * 0.85);
    expect(result.injectedTicks).toBeGreaterThan(expectedTicks * 0.85);

    // 2. Per-tick store-reducer cost stays tiny — the data path is not the
    //    frame-budget bottleneck. Measured ~160 µs/tick on a warm fresh
    //    server (208/sec sustained); at 200/sec that is ~32 ms of
    //    main-thread work PER SECOND (~3% of one core), leaving the frame
    //    budget free for the Canvas2D paint. The cost is environment-
    //    sensitive (it rose to ~300 µs on a long-running, GC-pressured dev
    //    server), so the ceiling is 500 µs — loose enough to tolerate a
    //    contended CI box, tight enough to catch a real O(n)-per-tick
    //    regression (a full-array clone over the ~900-cell ring would push
    //    this into the milliseconds, ~10× over the ceiling).
    expect(result.ingestPerTickMicros).toBeLessThan(500);
  });
});
