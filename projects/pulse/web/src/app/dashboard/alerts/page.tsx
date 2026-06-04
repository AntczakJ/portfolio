import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AlertsView } from '@/components/alerts/alerts-view';

export const metadata: Metadata = {
  title: 'Alerts',
};

/**
 * Alerts route (Task 5.6) — alert-channel configuration.
 *
 * Lists the configured webhook / email channels, a create dialog, delete, the
 * webhook signing-scheme hint, and the honest email-mock note.
 */
export default function AlertsPage(): ReactNode {
  return <AlertsView />;
}
