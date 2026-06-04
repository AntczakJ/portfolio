import { env } from '@/lib/env';
import { MonitorApiError } from '@/lib/api/monitors';
import type {
  AlertChannelResponse,
  CreateAlertChannel,
} from 'pulse-server';

/**
 * REST client for the alert-channels surface (Phase 5).
 *
 *   GET    /alert-channels      -> list (secret NEVER returned)
 *   POST   /alert-channels      -> create
 *   DELETE /alert-channels/:id  -> delete (204)
 *
 * The webhook `secret` is the per-channel HMAC key used to sign the outbound
 * payload (`X-Pulse-Signature` / `X-Pulse-Timestamp`); it is write-only — the
 * server stores it and never echoes it back.
 *
 * Requests carry `credentials: 'include'` so the better-auth session cookie
 * (Phase 6) travels — today the server resolves the seeded demo owner.
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
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const alertChannelsQueryKey = ['alert-channels'] as const;

export function listAlertChannels(): Promise<AlertChannelResponse[]> {
  return request<AlertChannelResponse[]>('/alert-channels');
}

export function createAlertChannel(
  input: CreateAlertChannel,
): Promise<AlertChannelResponse> {
  return request<AlertChannelResponse>('/alert-channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteAlertChannel(id: string): Promise<void> {
  await request<undefined>(`/alert-channels/${id}`, { method: 'DELETE' });
}
