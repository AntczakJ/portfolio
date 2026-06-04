/**
 * Compact relative-time formatting for the "last checked Ns ago" ticker.
 *
 * Pure so it is unit-tested without a clock. Returns terse, dashboard-style
 * strings ("just now", "12s ago", "5m ago", "2h ago", "3d ago") — the
 * Linear / Vercel register, kept short so the card metric row stays calm as
 * it ticks every second.
 *
 * `nowMs` is injected so the caller (the ticking hook) controls the clock
 * and tests are deterministic. A null/NaN input reads "never".
 */
export function formatRelativeTime(
  atMs: number | null | undefined,
  nowMs: number,
): string {
  if (atMs == null || Number.isNaN(atMs)) {
    return 'never';
  }
  const deltaSec = Math.max(0, Math.round((nowMs - atMs) / 1000));

  if (deltaSec < 3) {
    return 'just now';
  }
  if (deltaSec < 60) {
    return `${String(deltaSec)}s ago`;
  }
  const min = Math.floor(deltaSec / 60);
  if (min < 60) {
    return `${String(min)}m ago`;
  }
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}
