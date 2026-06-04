/**
 * Compact duration formatting for incident durations (the incidents view + the
 * detail incident history + the demo arc). Pure so it is unit-tested without a
 * clock.
 *
 * Renders the terse, dashboard-style register: "0s", "47s", "1m 23s",
 * "2h 05m", "1d 03h". An OPEN incident's duration ticks upward each second
 * (the caller recomputes `now - startedAt`), so the format must read calmly as
 * it counts; the mono / tabular-nums column keeps it from jittering.
 *
 * A negative input clamps to 0 (clock skew between the server's `startedAt`
 * baseline and the client clock must never render a negative duration).
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) {
    return '—';
  }
  const totalSec = Math.max(0, Math.floor(ms / 1000));

  if (totalSec < 60) {
    return `${String(totalSec)}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) {
    return `${String(min)}m ${pad(sec)}s`;
  }
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) {
    return `${String(hours)}h ${pad(remMin)}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${String(days)}d ${pad(remHours)}h`;
}

/**
 * The live duration of an incident as of `nowMs`. For an OPEN incident
 * (`resolvedAt` null) this is `now - startedAt`, ticking upward; for a CLOSED
 * incident it is the fixed resolved duration the server computed (or, as a
 * fallback, `resolvedAt - startedAt`). Clamped to >= 0.
 */
export function incidentDurationMs(
  startedAt: string,
  resolvedAt: string | null,
  serverDurationMs: number | null,
  nowMs: number,
): number | null {
  if (resolvedAt != null) {
    if (serverDurationMs != null) return Math.max(0, serverDurationMs);
    const start = Date.parse(startedAt);
    const end = Date.parse(resolvedAt);
    if (Number.isNaN(start) || Number.isNaN(end)) return serverDurationMs;
    return Math.max(0, end - start);
  }
  // Open incident — tick up from the started baseline.
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return serverDurationMs;
  return Math.max(0, nowMs - start);
}

function pad(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}
