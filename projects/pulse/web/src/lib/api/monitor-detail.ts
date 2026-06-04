import { env } from '@/lib/env';
import { MonitorApiError, type MonitorRow } from '@/lib/api/monitors';
import type {
  HistoryResponse,
  MonitorWindow,
  RecentChecksResponse,
  SeriesResponse,
  UptimeResponse,
} from 'pulse-server';

/**
 * REST client for the monitor-detail read surface (Phase 4.2 backend).
 *
 * All four endpoints are demo-owner scoped server-side and 404 on a monitor
 * the owner does not own; the detail page treats a 404 as "monitor not found".
 * Requests carry `credentials: 'include'` so the better-auth session cookie
 * (Phase 6) travels — today the server resolves the seeded demo owner.
 *
 *   GET /monitors/:id                 -> the monitor row (name, url, status...)
 *   GET /monitors/:id/uptime?window=  -> { uptimePercent, breakdown, source }
 *   GET /monitors/:id/series?window=  -> uPlot-native parallel arrays
 *   GET /monitors/:id/history?window= -> 90 worst-status buckets
 *   GET /monitors/:id/checks?limit=N  -> the latest N checks
 *
 * The window-keyed endpoints share the window selector on the detail page, so
 * the query keys below embed both `id` and `window` — switching the window
 * re-fetches exactly those three (uptime / series / history); the monitor row
 * and the recent-checks list are window-independent.
 */

async function request<T>(
  path: string,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) {
        detail = Array.isArray(body.message)
          ? body.message.join(', ')
          : body.message;
      }
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new MonitorApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

/** Query keys, namespaced so an `invalidateQueries` of one window is precise. */
export const monitorDetailKeys = {
  monitor: (id: string) => ['monitor', id] as const,
  uptime: (id: string, window: MonitorWindow) =>
    ['monitor', id, 'uptime', window] as const,
  series: (id: string, window: MonitorWindow) =>
    ['monitor', id, 'series', window] as const,
  history: (id: string, window: MonitorWindow) =>
    ['monitor', id, 'history', window] as const,
  checks: (id: string, limit: number) =>
    ['monitor', id, 'checks', limit] as const,
};

export function getMonitor(id: string): Promise<MonitorRow> {
  return request<MonitorRow>(`/monitors/${id}`);
}

export function getUptime(
  id: string,
  window: MonitorWindow,
): Promise<UptimeResponse> {
  return request<UptimeResponse>(`/monitors/${id}/uptime?window=${window}`);
}

export function getSeries(
  id: string,
  window: MonitorWindow,
): Promise<SeriesResponse> {
  return request<SeriesResponse>(`/monitors/${id}/series?window=${window}`);
}

export function getHistory(
  id: string,
  window: MonitorWindow,
): Promise<HistoryResponse> {
  return request<HistoryResponse>(`/monitors/${id}/history?window=${window}`);
}

export function getRecentChecks(
  id: string,
  limit = 50,
): Promise<RecentChecksResponse> {
  return request<RecentChecksResponse>(
    `/monitors/${id}/checks?limit=${String(limit)}`,
  );
}
