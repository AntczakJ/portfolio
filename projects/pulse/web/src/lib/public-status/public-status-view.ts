import type {
  PublicMonitor,
  PublicOverallStatus,
  PublicStatusPage,
} from 'pulse-server';

import type { DisplayStatus } from '@/lib/status/status-tokens';

/**
 * Pure presentation helpers for the public status page (Task 6.6).
 *
 * Kept IO-free so the data mapping — overall banner copy/tone, uptime
 * formatting, the "N incidents" summary, the open-monitor status display — is
 * exhaustively unit-testable without a network or React. The page component
 * does the IO (fetch + SSE) and the DOM; these functions own the mapping.
 *
 * The input is the REDACTED `GET /public/:slug` payload (no response times, no
 * private monitors) — these helpers never need a field that the redaction
 * boundary withholds.
 */

/** The banner's headline + accessible tone for an overall status. */
export interface OverallBanner {
  readonly headline: string;
  readonly tone: 'up' | 'degraded' | 'down';
  /** A monitor-style DisplayStatus for the banner dot (never color-alone). */
  readonly dotStatus: DisplayStatus;
}

/**
 * Map the server-derived overall status to the public banner. The server owns
 * the derivation (worst-monitor-wins, down dominates degraded — ADR-003), so
 * this is a pure presentation mapping, NOT a re-derivation.
 */
export function overallBanner(
  overall: PublicOverallStatus,
  incidentCount: number,
): OverallBanner {
  // C-3 — the banner must never contradict reality. If an incident is OPEN, the
  // page cannot read "All systems operational" even if the server's `overall`
  // momentarily lags (e.g. the monitor's status flipped back before the
  // incident closed). An open incident floors the banner to at least degraded.
  if (overall === 'operational' && incidentCount > 0) {
    return {
      headline: `Degraded performance — ${incidentLabel(incidentCount)}`,
      tone: 'degraded',
      dotStatus: 'degraded',
    };
  }
  switch (overall) {
    case 'operational':
      return {
        headline: 'All systems operational',
        tone: 'up',
        dotStatus: 'up',
      };
    case 'degraded':
      return {
        headline:
          incidentCount > 0
            ? `Degraded performance — ${incidentLabel(incidentCount)}`
            : 'Degraded performance',
        tone: 'degraded',
        dotStatus: 'degraded',
      };
    case 'outage':
      return {
        headline:
          incidentCount > 0
            ? `Active outage — ${incidentLabel(incidentCount)}`
            : 'Active outage',
        tone: 'down',
        dotStatus: 'down',
      };
  }
}

/** "1 active incident" / "3 active incidents". */
export function incidentLabel(count: number): string {
  return `${String(count)} active ${count === 1 ? 'incident' : 'incidents'}`;
}

/**
 * Format a monitor's 30-day uptime % for display. `null` (no observed data)
 * reads as a dash, not "0%". Two decimals when below 100, whole number at 100
 * (the Statuspage register — "100%" not "100.00%").
 */
export function formatUptime(uptimePercent: number | null): string {
  if (uptimePercent == null || Number.isNaN(uptimePercent)) {
    return '—';
  }
  const clamped = Math.max(0, Math.min(100, uptimePercent));
  if (clamped >= 100) {
    return '100%';
  }
  return `${clamped.toFixed(2)}%`;
}

/**
 * The display status for a public monitor row. The wire carries `up | degraded
 * | down | null`; `null` (never checked) maps to the UI-only `unknown` so the
 * StatusDot has a token + label (status is never color-alone).
 */
export function monitorDisplayStatus(monitor: PublicMonitor): DisplayStatus {
  return monitor.status ?? 'unknown';
}

/** Count the page's open (unresolved) incidents — drives the banner summary. */
export function openIncidentCount(page: PublicStatusPage): number {
  return page.incidents.filter((i) => i.status === 'open').length;
}
