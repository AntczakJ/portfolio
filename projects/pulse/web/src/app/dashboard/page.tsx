import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { StatusBoard } from '@/components/dashboard/status-board';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Dashboard home — the live status board (Task 3.3 / 3.4).
 *
 * The board is a client island: it owns the single `EventSource` on
 * `/api/stream`, the TanStack Query monitor list, and the Zustand live
 * store. The cards react in real time to real probes — the wow moment.
 */
export default function DashboardPage(): ReactNode {
  return <StatusBoard />;
}
