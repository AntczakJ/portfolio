import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { MonitorDetailView } from '@/components/detail/monitor-detail-view';

export const metadata: Metadata = {
  title: 'Monitor detail',
};

/**
 * Monitor-detail route (`/dashboard/monitors/[id]`) — Phase 4.
 *
 * The page itself is a thin server shell; the detail view is a client island
 * that owns the windowed TanStack queries, the uPlot chart, and the shared
 * SSE live store (the header status + the 24h chart live-append + the recent-
 * checks prepend). The auth guard for the dashboard segment lands in Phase 6.
 */
export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <MonitorDetailView monitorId={id} />;
}
