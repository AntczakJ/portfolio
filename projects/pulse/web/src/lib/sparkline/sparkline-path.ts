import type { SparklinePoint } from '@/lib/store/live-store';

/**
 * Pure data mapping for the hand-rolled response-time sparkline (ADR-001:
 * the card sparkline is plain SVG, NOT uPlot and NOT animated through
 * Motion — uPlot is reserved for the Phase 4 detail charts). Exported as a
 * pure function so the mapping is unit-tested without a DOM.
 *
 * Given the rolling buffer and a viewbox, it produces:
 *   - `line`: the `d` for the response-time polyline (null-valued points,
 *     e.g. transport errors, are breaks in the line so they read as gaps,
 *     not as a dive to zero),
 *   - `area`: the `d` for the faint fill under the line,
 *   - `lastPoint`: the coordinates of the newest point (for the leading
 *     dot),
 *   - `lastStatus`: the status of the newest point (to color the stroke).
 *
 * The y-scale is response time; it auto-fits to the buffer's max (with a
 * small headroom) so a slow monitor and a fast monitor each read at full
 * amplitude. A single point renders a flat midline so a brand-new monitor
 * still shows something.
 */

export interface SparklineGeometry {
  readonly line: string;
  readonly area: string;
  readonly lastPoint: { readonly x: number; readonly y: number } | null;
  readonly lastStatus: SparklinePoint['status'] | null;
  readonly hasData: boolean;
}

export interface SparklineDims {
  readonly width: number;
  readonly height: number;
  /** Vertical inset so the stroke and the leading dot are not clipped. */
  readonly pad?: number;
}

export function buildSparkline(
  points: readonly SparklinePoint[],
  dims: SparklineDims,
): SparklineGeometry {
  const { width, height, pad = 3 } = dims;
  const drawable = points.filter(
    (p): p is SparklinePoint & { value: number } => p.value !== null,
  );

  if (points.length === 0 || drawable.length === 0) {
    return {
      line: '',
      area: '',
      lastPoint: null,
      lastStatus: points.at(-1)?.status ?? null,
      hasData: false,
    };
  }

  const top = pad;
  const bottom = height - pad;
  const usableHeight = bottom - top;

  const max = Math.max(...drawable.map((p) => p.value));
  const min = Math.min(...drawable.map((p) => p.value));
  // Headroom so the peak does not touch the top edge; floor the span so a
  // flat series (all-equal values) draws a centred line, not a divide-by-0.
  const span = Math.max(max - min, 1);

  // X maps the FULL buffer index range (including null points) so gaps keep
  // their horizontal position; we only plot the drawable ones.
  const n = points.length;
  const stepX = n > 1 ? width / (n - 1) : 0;

  const yFor = (value: number): number => {
    const t = (value - min) / span;
    // Higher response time = higher on the chart (visually "worse up").
    return bottom - t * usableHeight;
  };

  // Build the line as segments broken by null points (gaps).
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length > 0) {
        segments.push(current.join(' '));
        current = [];
      }
      return;
    }
    const x = round(stepX * i);
    const y = round(yFor(p.value));
    current.push(`${current.length === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`);
  });
  if (current.length > 0) {
    segments.push(current.join(' '));
  }
  const line = segments.join(' ');

  // The fill area follows the last continuous segment down to the baseline.
  const lastDrawableIndex = lastIndexOfDrawable(points);
  const firstDrawableIndex = points.findIndex((p) => p.value !== null);
  const area =
    lastDrawableIndex >= 0 && firstDrawableIndex >= 0
      ? `${line} L${String(round(stepX * lastDrawableIndex))} ${String(round(bottom))} ` +
        `L${String(round(stepX * firstDrawableIndex))} ${String(round(bottom))} Z`
      : '';

  const lastDrawable = drawable[drawable.length - 1];
  if (lastDrawable === undefined) {
    // Unreachable: the empty-drawable case returned above. This guard is what
    // lets us read `lastDrawable.value` without a non-null assertion.
    return {
      line: '',
      area: '',
      lastPoint: null,
      lastStatus: points.at(-1)?.status ?? null,
      hasData: false,
    };
  }
  const lastIdx = lastDrawableIndex;
  const lastPoint = {
    x: round(stepX * lastIdx),
    y: round(yFor(lastDrawable.value)),
  };

  return {
    line,
    area,
    lastPoint,
    lastStatus: points.at(-1)?.status ?? lastDrawable.status,
    hasData: true,
  };
}

function lastIndexOfDrawable(points: readonly SparklinePoint[]): number {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i]?.value !== null) {
      return i;
    }
  }
  return -1;
}

/** Round to 2 dp to keep the SVG path string compact. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
