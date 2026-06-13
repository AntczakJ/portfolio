'use client';

import { useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';

import { api } from '@/lib/api/client';

/**
 * Health-status hook backing the chrome ApiStatusDot.
 *
 * Polls the Hono RPC `/health` route every 5 s through TanStack Query
 * and surfaces a flat status flag, the round-trip latency, the last
 * tick wall-clock, and the raw decoded payload.
 *
 * Type-safety: `HealthResponse` is inferred directly from the Hono RPC
 * client via `InferResponseType<typeof api.health.$get>`. No manual
 * schema duplication — the day `meld-server`'s `/health` route changes
 * its response shape, the next `pnpm -F meld-web typecheck` catches
 * it at this exact call site. The fallback path (importing the Zod
 * schema from `meld-server` and using `z.infer<>`) was considered and
 * rejected because `InferResponseType` resolves cleanly here and stays
 * runtime-free (the Zod schema would either drag the Zod runtime into
 * the client bundle via the non-type import or require a sibling
 * `import type` of just the inferred TypeScript type — strictly more
 * surface than the Hono-native helper).
 *
 * Status mapping:
 *   - `'idle'`      no fetch in flight yet (first paint, before mount).
 *   - `'loading'`   TanStack Query `isFetching` and no successful body
 *                   yet — covers cold-start and reconnect retries.
 *   - `'ok'`        last successful fetch returned 2xx, body decoded.
 *   - `'error'`     last fetch threw (network, abort) OR returned non-
 *                   2xx. `latencyMs` is still the delta from the probe
 *                   `performance.now()` start so an operator can tell
 *                   "instant 4xx" from "30 s timeout".
 *
 * Polling cadence is 5 s per spec — fast enough that the dot flips
 * "ok" within one tick of the server coming up during the wow-moment
 * demo, slow enough that an idle dashboard does not light up the
 * network panel of an inspecting recruiter.
 */

type HealthResponse = InferResponseType<typeof api.health.$get>;

export type ApiHealthStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface ApiHealth {
  status: ApiHealthStatus;
  /** Round-trip duration in milliseconds. `null` until the first probe. */
  latencyMs: number | null;
  /** `Date.now()` of the last completed probe (success or failure). */
  lastTick: number | null;
  /** Decoded payload from the most recent successful probe. */
  raw: HealthResponse | null;
}

interface ProbeResult {
  body: HealthResponse;
  latencyMs: number;
  tick: number;
}

async function probeHealth(signal: AbortSignal): Promise<ProbeResult> {
  const t0 = performance.now();
  const res = await api.health.$get(undefined, { init: { signal } });
  const latencyMs = Math.round(performance.now() - t0);
  if (!res.ok) {
    throw new Error(`health probe returned HTTP ${String(res.status)}`);
  }
  const body: HealthResponse = await res.json();
  // Sanity-check the literal status field at runtime. The RPC type
  // narrows `status` to the literal 'ok', so we widen to `string`
  // here before comparing — otherwise the typed view makes the guard
  // look dead. If the server changes the contract so that `status` is
  // no longer present, the InferResponseType drift surfaces in
  // `pnpm typecheck`; this guard catches a same-shape value drift the
  // type system cannot see. The Task 2.2 contract experiment exercises
  // this guarantee.
  const reportedStatus: string = body.status;
  if (reportedStatus !== 'ok') {
    throw new Error(`health probe reported status ${reportedStatus}`);
  }
  return { body, latencyMs, tick: Date.now() };
}

export function useApiHealth(): ApiHealth {
  const query = useQuery({
    queryKey: ['api-health'],
    queryFn: ({ signal }) => probeHealth(signal),
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  let status: ApiHealthStatus;
  if (query.isError) {
    status = 'error';
  } else if (query.data) {
    status = 'ok';
  } else if (query.isFetching) {
    status = 'loading';
  } else {
    status = 'idle';
  }

  return {
    status,
    latencyMs: query.data?.latencyMs ?? null,
    lastTick: query.data?.tick ?? null,
    raw: query.data?.body ?? null,
  };
}
