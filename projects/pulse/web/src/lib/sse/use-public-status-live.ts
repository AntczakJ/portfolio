'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { env } from '@/lib/env';
import {
  getPublicStatusPage,
  publicStatusQueryKey,
} from '@/lib/api/public-status';
import { SSE_EVENT_NAMES } from '@/lib/sse/event-names';
import type { PublicStatusPage } from 'pulse-server';

/**
 * The PUBLIC status-page live client (Task 6.6, ADR-003).
 *
 * The page SSRs from `GET /public/:slug` (the SEO floor), then this hook keeps
 * it live. It opens ONE `EventSource` on `${sseUrl}/api/public/:slug/stream` —
 * the already-REDACTED public stream (it carries ONLY `status.change` /
 * `incident.open` / `incident.close` for the page's public monitors; never raw
 * `check.result` response times or `alert.fired`). No `withCredentials`: the
 * public page is anonymous.
 *
 * Rather than re-derive the overall banner client-side from individual events
 * (and risk drifting from the server's redaction), it treats any public event
 * (and every reconnect) as a signal to RE-FETCH the cheap, rollup-backed
 * `GET /public/:slug` snapshot — the same ADR-003 "reconcile via REST" model the
 * dashboard uses. The server stays the single source of truth for the redacted
 * shape; the client just knows WHEN to refresh.
 *
 * `initialData` seeds the query with the SSR payload so there is no second
 * fetch on hydration and no loading flash.
 */

export type PublicConnectionState = 'connecting' | 'live' | 'reconnecting';

export function usePublicStatusLive(
  slug: string,
  initialData: PublicStatusPage,
): { data: PublicStatusPage; connection: PublicConnectionState } {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<PublicConnectionState>('connecting');

  const query = useQuery({
    queryKey: publicStatusQueryKey(slug),
    queryFn: () => getPublicStatusPage(slug),
    initialData,
    // The SSE event drives the refresh, not a polling interval.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Stable refetch ref so the EventSource effect does not churn on re-render.
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = `${env.sseUrl}/api/public/${encodeURIComponent(slug)}/stream`;
    const source = new EventSource(url);
    let everOpen = false;

    source.onopen = () => {
      everOpen = true;
      setConnection('live');
      void refetchRef.current();
    };
    source.onerror = () => {
      setConnection(everOpen ? 'reconnecting' : 'connecting');
    };

    // Any redacted public event = "the page changed" -> refetch the snapshot.
    const listener = () => {
      void refetchRef.current();
    };
    const names = SSE_EVENT_NAMES.filter(
      (n) => n !== 'check.result' && n !== 'alert.fired' && n !== 'heartbeat',
    );
    for (const name of names) {
      source.addEventListener(name, listener as EventListener);
    }

    return () => {
      for (const name of names) {
        source.removeEventListener(name, listener as EventListener);
      }
      source.close();
    };
  }, [slug, queryClient]);

  return { data: query.data, connection };
}
