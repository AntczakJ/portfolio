import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { IncidentsView } from '@/components/incidents/incidents-view';

export const metadata: Metadata = {
  title: 'Incidents',
};

/**
 * Incidents route (Task 5.4) — the recent-incidents timeline.
 *
 * A client island: it reads `GET /incidents`, opens the shared live
 * `EventSource`, and live-updates from the incident SSE events (open prepends,
 * close resolves, open durations tick up).
 */
export default function IncidentsPage(): ReactNode {
  return <IncidentsView />;
}
