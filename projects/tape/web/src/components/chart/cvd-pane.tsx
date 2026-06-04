'use client';

/**
 * <CvdPane /> — CVD line sub-pane (Task 3.2c).
 *
 * A thin React shell that owns a SECOND canvas and hands it to the
 * already-mounted `FootprintChartEngine` via context. The engine paints
 * this canvas in its EXISTING rAF pass with the SAME `ChartScale` as the
 * footprint, so:
 *   - there is exactly ONE render loop for both panes (no second rAF),
 *   - the X-axis is locked to the footprint above (a `bucketTs` lands at
 *     the same X column in both),
 *   - theme flips and store updates already flip the engine dirty flag,
 *     so the CVD pane repaints through the same path as the chart.
 *
 * The shell does only the canvas plumbing the engine cannot do itself:
 *   1. Render the `<canvas>` and attach / detach it to the engine.
 *   2. Observe size changes via `ResizeObserver` and forward them
 *      (with DPR backing-store scaling) to `engine.handleCvdResize`.
 *
 * It does NOT subscribe to the store or read `cvdSeries` in React — the
 * engine reads the Zustand store directly (the seam is
 * `useCvdSeries()`/`state.cvdSeries`, consumed inside the engine's
 * paint pass, not here). Keeping React out of the per-frame path
 * preserves the no-layout-thrash budget.
 *
 * Reduced motion: the CVD line still updates (it is data, not
 * decoration). There is no per-frame animation to gate — the engine's
 * dirty-flag gate already skips idle frames, and the pane carries no
 * transitions of its own. The global `prefers-reduced-motion` CSS net
 * plus the engine's existing reduced-motion scroll handling cover the
 * only motion in the chart.
 *
 * Accessibility: the canvas is decorative-with-a-text-equivalent. The
 * current cumulative value is mirrored to a visually-hidden
 * `aria-live="polite"` node so a screen-reader user hears the CVD trend
 * without reading pixels. The numeric value + slope direction are the
 * non-colour channel (WCAG: never colour alone).
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { useFootprintEngine } from '@/lib/chart/engine-context';
import { useCvdSeries } from '@/lib/stores/stream-store';
import { cvdSlopeDirection } from '@/lib/chart/painters/cvd';

/** Fixed CVD pane height in CSS pixels — enough for a legible line +
 * the in-pane numeric label without stealing footprint real estate. */
const CVD_PANE_HEIGHT = 96;

function formatCvdForSr(v: number): string {
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(1));
  if (rounded === 0) return 'flat at zero';
  return rounded > 0
    ? `positive ${String(rounded)}`
    : `negative ${String(Math.abs(rounded))}`;
}

function slopeWord(dir: -1 | 0 | 1): string {
  return dir > 0 ? 'rising' : dir < 0 ? 'falling' : 'flat';
}

export function CvdPane(): ReactNode {
  const engine = useFootprintEngine();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const series = useCvdSeries();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (engine === null) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;

    engine.attachCvdCanvas(canvas);

    const applySize = (width: number, height: number): void => {
      engine.handleCvdResize(width, height, window.devicePixelRatio || 1);
    };

    const rect = container.getBoundingClientRect();
    applySize(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      applySize(width, height);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      engine.detachCvdCanvas();
    };
  }, [engine]);

  // SR mirror string. Derived in React (cheap — fires only when the
  // bounded series array identity changes, i.e. on a bar fold, NOT per
  // frame). The pixels are drawn by the engine; this is the text
  // equivalent.
  const current = series[series.length - 1]?.cvd ?? 0;
  const dir = cvdSlopeDirection(series);

  return (
    <div
      ref={containerRef}
      aria-label="Cumulative volume delta"
      className="relative w-full shrink-0 overflow-hidden border-t border-(--color-grid)"
      style={{ height: `${String(CVD_PANE_HEIGHT)}px` }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <span className="sr-only" role="status" aria-live="polite">
        {`Cumulative volume delta ${formatCvdForSr(current)}, ${slopeWord(dir)}.`}
      </span>
    </div>
  );
}
