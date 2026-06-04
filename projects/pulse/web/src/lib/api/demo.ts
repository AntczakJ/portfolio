import { env } from '@/lib/env';
import { MonitorApiError } from '@/lib/api/monitors';

/**
 * REST client for the demo-incident trigger (Phase 5 / ADR-006) — the wow beat.
 *
 *   POST /demo/trigger -> { armed, failWindowSeconds, note }
 *   GET  /demo/status  -> { failing, recoversInSeconds }
 *
 * `POST /demo/trigger` only flips a Redis flag so the OWNED `/demo/flaky`
 * endpoint starts failing; the incident opens and closes ORGANICALLY through the
 * real probe cycle (no faked arc). The board reacts via the SSE events it
 * already consumes. Both routes 404 when `DEMO_TRIGGER_ENABLED` is off.
 */

export interface DemoTriggerResponse {
  readonly armed: true;
  readonly failWindowSeconds: number;
  readonly note: string;
}

export interface DemoStatusResponse {
  readonly failing: boolean;
  readonly recoversInSeconds: number;
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
    throw new MonitorApiError(res.statusText, res.status);
  }
  return (await res.json()) as T;
}

export function triggerDemoIncident(): Promise<DemoTriggerResponse> {
  return request<DemoTriggerResponse>('/demo/trigger', { method: 'POST' });
}

export function getDemoStatus(): Promise<DemoStatusResponse> {
  return request<DemoStatusResponse>('/demo/status');
}
