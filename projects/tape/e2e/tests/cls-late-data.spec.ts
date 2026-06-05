import { expect, test } from '@playwright/test';

import {
  buildFootprintSnapshot,
  SNAPSHOT_CLOSED_CELL_COUNT,
} from '../fixtures/footprint-snapshot';
import { TapeApp } from '../helpers/tape-app';

/**
 * `cls-late-data.spec.ts` — proves the late-data CLS fix.
 *
 * THE BUG (live deploy): tape connects its WebSocket AFTER first paint
 * (deferred behind `requestIdleCallback`, Task 5.4), so the snapshot lands
 * ~1 s into the session. Before the fix, the regions that POPULATE from
 * that snapshot — the status-bar value cells ("Ticks 0" -> "Ticks N", the
 * latency, the last-tick), the tape header count — grew their boxes when
 * the values filled in, shifting their neighbours. On the narrow Lighthouse
 * MOBILE viewport (360 px) that growth could push a status-bar cell to WRAP
 * onto a second row — a large vertical shift. That post-paint reflow is the
 * live-deploy CLS (Lighthouse measured 0.337). A local prod build with no
 * WS never sees it (no late data), so it MUST be reproduced by INJECTING
 * the late snapshot.
 *
 * THIS TEST reproduces the live populate deterministically, at BOTH a
 * desktop width and the Lighthouse mobile width:
 *   1. Install a `PerformanceObserver('layout-shift')` at document start
 *      (via `addInitScript`) that accumulates the CLS score, tags each
 *      meaningful entry with the shifting node, and splits the score at a
 *      "settle mark".
 *   2. Navigate, wait for hydration, let the initial layout SETTLE, then
 *      record the settle mark.
 *   3. ~1.5 s after load (mimicking the deferred-WS snapshot timing),
 *      inject a full snapshot + a burst of live ticks + the widest tick
 *      count through `window.__tapeStore` — the exact late-populate the
 *      live deploy does.
 *   4. Read the CLS attributable to entries AFTER the settle mark — the
 *      injection-driven shift. With the reserved-dimension fix it must be
 *      ~0 (< 0.01). Without it, the data-bearing regions shift.
 *
 * `window.__tapeStore` only exists in a DEV build (DCE'd in prod), so this
 * runs against the auto-started dev server like the rest of the harness.
 * The late-data shift is STRUCTURAL (DOM box growth / wrap), not a dev
 * artefact — it reproduces identically to the live prod deploy.
 */

interface ClsCapture {
  total: number;
  afterMark: number;
  sources: string[];
}

declare global {
  interface Window {
    __clsTotal?: number;
    __clsMark?: number;
    __clsAfterMark?: number;
    __clsSources?: string[];
    __markClsSettle?: () => void;
  }
}

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile-360', width: 360, height: 740 },
] as const;

test.describe('late-data CLS', () => {
  for (const vp of VIEWPORTS) {
    test(`[${vp.name}] snapshot + tick burst injection causes ~0 layout shift`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Observe layout-shift from the very first navigation. Excludes
      // shifts with recent input (the CLS spec convention). Splits the
      // score into a running total and an "after settle mark" bucket so we
      // isolate the injection-attributable shift, and records the shifting
      // node for any meaningful entry so the test can NAME the region.
      await page.addInitScript(() => {
        window.__clsTotal = 0;
        window.__clsAfterMark = 0;
        window.__clsMark = Number.POSITIVE_INFINITY;
        window.__clsSources = [];
        window.__markClsSettle = () => {
          window.__clsMark = performance.now();
        };
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const e = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources?: { node?: Node }[];
            };
            if (e.hadRecentInput) continue;
            window.__clsTotal = (window.__clsTotal ?? 0) + e.value;
            const afterMark =
              entry.startTime >= (window.__clsMark ?? Number.POSITIVE_INFINITY);
            if (afterMark) {
              window.__clsAfterMark = (window.__clsAfterMark ?? 0) + e.value;
            }
            if (e.value > 0.0005) {
              const tags = (e.sources ?? [])
                .map((s) => {
                  const node = s.node as { tagName?: string } | undefined;
                  if (node === undefined) return '?';
                  const el = node as unknown as Element;
                  const aria = el.getAttribute('aria-label') ?? '';
                  const tag = node.tagName ?? '?';
                  return aria ? `${tag}[${aria}]` : tag;
                })
                .join(' | ');
              window.__clsSources?.push(
                `${afterMark ? 'AFTER' : 'before'} ${e.value.toFixed(4)} :: ${tags}`,
              );
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
      });

      const app = new TapeApp(page);
      await app.mockWebSocket();
      await app.goto();
      await app.waitForHydrated();

      // Let the initial layout settle, then mark. Everything after the mark
      // is attributable to the late-data injection below. The deferred-WS
      // snapshot on the live deploy lands ~1 s in; we mirror that timing.
      await page.waitForTimeout(1_500);
      await page.evaluate(() => {
        window.__markClsSettle?.();
      });

      // Inject the late snapshot — exactly what the live deploy's deferred
      // WebSocket does. ingestSnapshot seeds the cells/CVD/tick-ring
      // (populates the chart + tape + tape header count).
      const snapshot = buildFootprintSnapshot();
      const injected = await app.injectSnapshot(snapshot);
      expect(injected.closedCells).toBe(SNAPSHOT_CLOSED_CELL_COUNT);

      // Drive a burst of live ticks (refreshes "Last tick" + tape rows),
      // then force the "Ticks" cell to its WIDEST grouped form
      // ("1,234,567") — the maximal box-growth case the live deploy reaches
      // over a long session. If the status-bar cells were not
      // width-reserved, this is the populate that shifts their neighbours
      // (and, on the 360 px viewport, can wrap the bar to a second row).
      await page.evaluate(() => {
        const store = window.__tapeStore;
        if (store === undefined) throw new Error('__tapeStore missing');
        const ingest = store.getState().ingestFrame;
        const base = Date.now();
        for (let i = 0; i < 600; i += 1) {
          ingest({
            topic: 'ticks.btc',
            kind: 'tick',
            payload: {
              tsMs: base + i,
              price: 71_000 + (i % 40) - 20,
              qty: 0.05 + (i % 7) * 0.03,
              aggressor: i % 2 === 0 ? 'buy' : 'sell',
            },
          });
        }
        store.setState({ tickCount: 1_234_567 });
      });

      // Give the populated values a few frames to paint + the observer to
      // flush any shift they caused.
      await page.waitForTimeout(800);

      const cls: ClsCapture = await page.evaluate(() => ({
        total: window.__clsTotal ?? 0,
        afterMark: window.__clsAfterMark ?? 0,
        sources: window.__clsSources ?? [],
      }));

      // Sanity: the populate happened (the bar is showing a numeric value).
      const ticksCell = page
        .getByRole('contentinfo')
        .locator('dd')
        .filter({ hasText: /\d/ });
      await expect(ticksCell.first()).toBeVisible();

      console.log(
        `[CLS ${vp.name}] total=${cls.total.toFixed(5)} injection-attributable=${cls.afterMark.toFixed(5)}`,
      );
      for (const s of cls.sources) {
        console.log(`[CLS-src ${vp.name}] ${s}`);
      }

      // The injection-attributable CLS must be ~0. This is the number that
      // was the live-deploy 0.337 before the reserved-dimension fix.
      expect(cls.afterMark).toBeLessThan(0.01);
    });
  }
});

declare global {
  interface Window {
    __tapeStore?: {
      getState: () => { ingestFrame: (frame: unknown) => void };
      setState: (partial: Record<string, unknown>) => void;
    };
  }
}
