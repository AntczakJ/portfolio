/**
 * Pure presentation formatters for the fleet panels (Task 5.1 / 5.2).
 *
 * Kept pure + side-effect-free so they unit-test trivially and render
 * identically on the server (the SSR floor, Phase 6) and the client. Numerals
 * are rendered for the IBM Plex Mono tabular treatment (the `.tabular` /
 * `font-mono` utility) so they read as instrument output.
 */

/**
 * Format a live ETA (seconds to the next stop) as a compact `m:ss` / `h:mm:ss`
 * countdown. `null` (no next stop, or no meaningful estimate yet — a dwelling
 * vehicle with no rolling average) renders as an em dash so the column never
 * shows a misleading `0:00`.
 */
export function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds)) return '—';
  const total = Math.max(0, Math.round(etaSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) {
    const mm = String(m).padStart(2, '0');
    return `${String(h)}:${mm}:${ss}`;
  }
  return `${String(m)}:${ss}`;
}

/** A screen-reader-friendly ETA, e.g. "4 minutes 5 seconds" / "unknown". */
export function formatEtaLong(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds)) return 'unknown';
  const total = Math.max(0, Math.round(etaSeconds));
  if (total < 60) return `${String(total)} second${total === 1 ? '' : 's'}`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const mins = `${String(m)} minute${m === 1 ? '' : 's'}`;
  if (s === 0) return mins;
  return `${mins} ${String(s)} second${s === 1 ? '' : 's'}`;
}

/** Format speed in km/h from metres/second, one decimal place. */
export function formatSpeed(speedMps: number): string {
  const kmh = speedMps * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

/** Format route progress (0..1) as a whole-percent string. */
export function formatProgress(progress: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return `${String(pct)}%`;
}

/** Whole-percent number (0..100) for an aria-valuenow / width style. */
export function progressPercent(progress: number): number {
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/**
 * Relative time for an event row, e.g. "now" / "12s" / "4m" / "1h".
 * `nowMs` is injected so it is pure + testable (no `Date.now()` inside).
 */
export function formatRelativeTime(atIso: string, nowMs: number): string {
  const at = Date.parse(atIso);
  if (Number.isNaN(at)) return '';
  const deltaSec = Math.max(0, Math.round((nowMs - at) / 1000));
  if (deltaSec < 5) return 'now';
  if (deltaSec < 60) return `${String(deltaSec)}s`;
  if (deltaSec < 3600) return `${String(Math.floor(deltaSec / 60))}m`;
  return `${String(Math.floor(deltaSec / 3600))}h`;
}
