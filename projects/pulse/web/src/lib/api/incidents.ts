import { env } from '@/lib/env';
import { MonitorApiError } from '@/lib/api/monitors';
import type {
  IncidentListItem,
  IncidentsListResponse,
} from 'pulse-server';

/**
 * REST client for the incident-history read surface (Phase 5 read surface).
 *
 *   GET /incidents?limit&status            -> recent incidents, all monitors
 *   GET /monitors/:id/incidents?limit&status -> incidents for one monitor
 *
 * Both return the same `{ monitorId, items }` shape (newest-first). The
 * incidents view reconciles the REST snapshot with the live SSE `incident.*`
 * overlay (the live store) so a row that opened/closed live reflects instantly.
 *
 * Requests carry `credentials: 'include'` so the better-auth session cookie
 * (Phase 6) travels — today the server resolves the seeded demo owner.
 */

export type IncidentStatusFilter = 'all' | 'open' | 'resolved';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
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

/** Query keys, namespaced so the filter and the limit invalidate precisely. */
export const incidentKeys = {
  all: ['incidents'] as const,
  list: (filter: IncidentStatusFilter, limit: number) =>
    ['incidents', 'list', filter, limit] as const,
  forMonitor: (id: string, limit: number) =>
    ['incidents', 'monitor', id, limit] as const,
};

function statusParam(filter: IncidentStatusFilter): string {
  return filter === 'all' ? '' : `&status=${filter}`;
}

export function listIncidents(
  filter: IncidentStatusFilter = 'all',
  limit = 50,
): Promise<IncidentsListResponse> {
  return request<IncidentsListResponse>(
    `/incidents?limit=${String(limit)}${statusParam(filter)}`,
  );
}

export function listMonitorIncidents(
  monitorId: string,
  limit = 20,
): Promise<IncidentsListResponse> {
  return request<IncidentsListResponse>(
    `/monitors/${monitorId}/incidents?limit=${String(limit)}`,
  );
}

export type { IncidentListItem };
