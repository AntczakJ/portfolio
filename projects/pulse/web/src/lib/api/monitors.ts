import { env } from '@/lib/env';
import type {
  CreateMonitorInput,
  MonitorResponse,
  UpdateMonitor,
} from 'pulse-server';

/**
 * REST client for the monitors surface (`GET /monitors`, `POST /monitors`).
 *
 * The live board's INITIAL data and its reconnect reconciliation come from
 * `GET /monitors` (TanStack Query); live updates then arrive over SSE. The
 * create-monitor dialog posts here, after which the new card appears and
 * starts going live within an interval (the wow-moment "add a URL, watch it
 * pulse" flow).
 *
 * Requests carry `credentials: 'include'` so the better-auth session cookie
 * (Phase 6) travels — today the server resolves the seeded demo owner, so
 * the calls succeed unauthenticated, but the cookie path is already correct.
 */

/**
 * The monitor row the board reads. Extends the shared `MonitorResponse`
 * with the Phase 2 live-status columns (migration 0001:
 * `monitors.current_status` / `monitors.last_checked_at`) that the list
 * endpoint returns but the base schema type does not yet model. Both are
 * nullable: `currentStatus === null` is the ADR-004 never-checked / unknown
 * state.
 */
export interface MonitorRow extends MonitorResponse {
  readonly currentStatus: 'up' | 'degraded' | 'down' | null;
  readonly lastCheckedAt: string | null;
}

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
  // 204 No Content (DELETE) has no body — do not attempt to parse it.
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export class MonitorApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MonitorApiError';
    this.status = status;
  }
}

/** TanStack Query key for the monitor list. */
export const monitorsQueryKey = ['monitors'] as const;

export function listMonitors(): Promise<MonitorRow[]> {
  return request<MonitorRow[]>('/monitors');
}

export function createMonitor(
  input: CreateMonitorInput,
): Promise<MonitorRow> {
  return request<MonitorRow>('/monitors', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH a monitor — used by the edit dialog and the pause toggle. */
export function updateMonitor(
  id: string,
  patch: UpdateMonitor,
): Promise<MonitorRow> {
  return request<MonitorRow>(`/monitors/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** DELETE a monitor (204 No Content). */
export async function deleteMonitor(id: string): Promise<void> {
  await request<undefined>(`/monitors/${id}`, { method: 'DELETE' });
}
