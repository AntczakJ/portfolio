'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/treaty';

export type ApiHealthStatus = 'pending' | 'online' | 'offline';

export interface ApiHealth {
  status: ApiHealthStatus;
  /** Round-trip duration in milliseconds. `null` until the first response. */
  latencyMs: number | null;
}

interface HealthPayload {
  ok: boolean;
  latencyMs: number;
}

async function fetchHealth(signal: AbortSignal): Promise<HealthPayload> {
  const t0 = performance.now();
  const { data, error } = await api.health.get({ fetch: { signal } });
  if (error || !data) {
    throw new Error(
      `Health endpoint returned ${error ? String(error.status) : 'no data'}`,
    );
  }
  return { ok: true, latencyMs: Math.round(performance.now() - t0) };
}

/**
 * Shared health probe. Both ApiStatus and the bottom status bar subscribe
 * to the same query key so TanStack dedupes — one network call serves
 * every consumer in the tree.
 */
export function useApiHealth(): ApiHealth {
  const { data, status } = useQuery({
    queryKey: ['api-health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 15_000,
    retry: false,
  });

  const apiStatus: ApiHealthStatus =
    status === 'pending' ? 'pending' : data?.ok ? 'online' : 'offline';

  return {
    status: apiStatus,
    latencyMs: data?.latencyMs ?? null,
  };
}
