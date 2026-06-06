import type { ReactNode } from 'react';

import { OpsDashboard } from '@/components/dashboard/ops-dashboard';

/**
 * Root route — the live operations dashboard (the lead surface, viewer 1).
 *
 * Phase 6 adds the marketing/landing + SEO surface (the SSR floor: pitch +
 * static fleet snapshot table + route/zone reference + JSON-LD/OG). For the
 * Phase 2 scaffold the root renders the control-room dashboard directly so the
 * app shell + the map centerpiece are the reviewable surface.
 */
export default function HomePage(): ReactNode {
  return <OpsDashboard />;
}
