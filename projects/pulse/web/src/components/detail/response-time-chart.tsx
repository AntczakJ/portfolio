'use client';

import 'uplot/dist/uPlot.min.css';

import uPlot from 'uplot';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTheme } from 'next-themes';

import {
  appendLivePoint,
  toUplotData,
  type LivePoint,
  type UplotData,
} from '@/lib/chart/series-adapter';
import type { SeriesResponse } from 'pulse-server';

/**
 * The response-time chart — an IMPERATIVE uPlot wrapper that lives OUTSIDE the
 * React render path (ADR-001 / the meld "the streaming surface is not Motion /
 * Canvas2D" discipline, repeated for uPlot here).
 *
 * The contract with React is deliberately thin:
 *   - the uPlot instance is created ONCE on mount (or when the series SHAPE
 *     changes — raw 1-series vs hourly 2-series, which needs a different uPlot
 *     `series` config),
 *   - new windowed data is pushed via `setData` in an effect, NOT by
 *     re-rendering uPlot through React,
 *   - live 24h points are appended via `setData` from an imperative ref the
 *     parent calls (`onReady` hands back an `appendLive` fn) — again no React
 *     re-render per point,
 *   - the canvas resizes via a ResizeObserver, and the instance is destroyed
 *     on unmount.
 *
 * Theme-awareness: uPlot is canvas, so it cannot inherit CSS variables — we
 * READ the resolved token values off `getComputedStyle(document.documentElement)`
 * and pass concrete colors into the uPlot options, rebuilding the instance when
 * the theme flips. Reduced-motion is a non-issue (uPlot does no animation); the
 * chart simply repaints.
 *
 * CSP: uPlot is plain canvas — no `eval`, no `new Function`. It runs clean under
 * the strict no-`unsafe-eval` CSP (verified against the prod build).
 */

interface ResponseTimeChartProps {
  series: SeriesResponse;
  /** ms height of the plotting area. */
  height?: number;
  /**
   * Receives an imperative live-append handle once the chart is ready. The
   * parent (the detail page) calls it on each 24h SSE `check.result`. Only
   * meaningful for the raw (24h) resolution — the parent gates on that.
   */
  onReady?: (handle: ChartHandle) => void;
}

export interface ChartHandle {
  /** Append one live point to the 24h raw chart (no-op for hourly). */
  appendLive: (point: LivePoint) => void;
  /** The current x-domain tail (UNIX seconds) so the parent can de-dupe. */
  lastX: () => number | null;
}

/** Read a resolved CSS custom property as a concrete color string. */
function readToken(name: string): string {
  if (typeof window === 'undefined') return '#888';
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v.length > 0 ? v : '#888';
}

interface Palette {
  axis: string;
  grid: string;
  series: string[];
  bg: string;
  point: string;
}

function readPalette(resolution: SeriesResponse['resolution']): Palette {
  const axis = readToken('--color-fg-subtle');
  // M-4 — lighten the gridlines: the dense 30d chart's grid competed with the
  // series. The `--color-border` line is dropped to a faint wash via rgba.
  const grid = withAlpha(readToken('--color-border'), 0.45);
  const brand = readToken('--color-brand');
  // p95 is demoted to a faint wash of the subtle ink so the average reads as
  // the primary series and the p95 as quiet context (M-4).
  const subtle = withAlpha(readToken('--color-fg-muted'), 0.4);
  return {
    axis,
    grid,
    bg: 'transparent',
    point: brand,
    // raw: one brand series; hourly: avg (brand) + p95 (faint).
    series: resolution === 'raw' ? [brand] : [brand, subtle],
  };
}

/**
 * Apply an alpha to a resolved CSS color token. Tokens resolve to `oklch(...)`
 * (or hex) — `color-mix` keeps it color-space-correct and works for both,
 * so the gridline / p95 wash is theme-correct without re-reading the bg.
 */
function withAlpha(color: string, alpha: number): string {
  if (!color || color === '#888') return color;
  const pct = Math.round(alpha * 100);
  return `color-mix(in oklch, ${color} ${String(pct)}%, transparent)`;
}

function buildOptions(
  series: SeriesResponse,
  width: number,
  height: number,
  palette: Palette,
): uPlot.Options {
  const labels = series.resolution === 'raw' ? ['Response'] : ['Average', 'p95'];

  const ySeries: uPlot.Series[] = labels.map((label, i) => {
    // M-4 — the average is the primary line; p95 is demoted to a thin, dashed,
    // faint wash so the two read apart and the chart is calmer at 30d density.
    const isP95 = series.resolution === 'hourly' && i === 1;
    return {
      label,
      stroke: palette.series[i] ?? palette.point,
      width: isP95 ? 1 : series.resolution === 'raw' ? 1.5 : 1.75,
      ...(isP95 ? { dash: [3, 5] } : {}),
      points: { show: false },
      // Gaps (null) are line breaks, not interpolated.
      spanGaps: false,
    };
  });

  return {
    width,
    height,
    padding: [12, 12, 4, 4],
    cursor: {
      points: { show: true, size: 6 },
      // No drag-zoom — this is a read-only overview chart.
      drag: { x: false, y: false },
    },
    legend: { show: false },
    scales: {
      x: { time: true },
      y: {
        range: (_u, _min, max) => {
          // Floor at 0, pad the top a touch so the line is not flush to the edge.
          const top = max > 0 ? max * 1.1 : 100;
          return [0, top];
        },
      },
    },
    axes: [
      {
        stroke: palette.axis,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.grid, width: 1 },
        font: '11px var(--font-mono)',
        size: 36,
      },
      {
        stroke: palette.axis,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.grid, width: 1 },
        font: '11px var(--font-mono)',
        size: 46,
        values: (_u, vals) => vals.map((v) => `${String(v)}ms`),
      },
    ],
    series: [{}, ...ySeries],
  };
}

export function ResponseTimeChart({
  series,
  height = 240,
  onReady,
}: ResponseTimeChartProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<UplotData>([[], []]);
  const { resolvedTheme } = useTheme();
  // Keep the latest onReady without re-creating the chart on each render.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Create / recreate the uPlot instance when the series SHAPE (resolution) or
  // the theme changes. Window/data changes do NOT recreate — they `setData`.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const palette = readPalette(series.resolution);
    const shaped = toUplotData(series);
    dataRef.current = shaped.data;

    const width = container.clientWidth || 600;
    const opts = buildOptions(series, width, height, palette);
    const plot = new uPlot(
      opts,
      shaped.data as uPlot.AlignedData,
      container,
    );
    plotRef.current = plot;

    const handle: ChartHandle = {
      appendLive: (point) => {
        // Only the raw 24h chart live-appends; hourly is rollup-driven.
        if (series.resolution !== 'raw') return;
        const next = appendLivePoint(dataRef.current, point);
        dataRef.current = next;
        plotRef.current?.setData(next as uPlot.AlignedData);
      },
      lastX: () => {
        const xs = dataRef.current[0] ?? [];
        const v = xs[xs.length - 1];
        return typeof v === 'number' ? v : null;
      },
    };
    onReadyRef.current?.(handle);

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) {
        plotRef.current?.setSize({ width: w, height });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Recreate on resolution or theme flip; height is stable per render.
  }, [series.resolution, resolvedTheme, height, series]);

  // NOTE: `series` is in the dep array so a window/data refetch also runs this
  // effect; the instance is rebuilt with fresh data. For the high-frequency
  // path (live 24h appends) we do NOT go through React at all — the parent
  // calls `handle.appendLive`, which `setData`s imperatively. React only drives
  // the coarse-grained window/theme transitions, exactly the ADR boundary.

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height }}
      // The canvas is decorative reinforcement of the numeric series; the
      // uptime cards + recent-checks list carry the same data accessibly.
      aria-hidden="true"
    />
  );
}
