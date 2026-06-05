import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ReservationWizard } from '@/components/reserve/reservation-wizard';

/**
 * `/reserve` — the reservation wizard route (Task 5.4-5.6).
 *
 * A server component that mounts the client wizard. Static metadata stays in the
 * head (SEO); the wizard reads the deep-link params client-side inside a Suspense
 * boundary (so the route stays static and the persisted draft is restored on the
 * client). `robots: noindex` — this is a transactional flow, not an indexable
 * marketing page.
 */
export const metadata: Metadata = {
  title: 'Reserve your APEX',
  description:
    'Choose your car, dates, pick-up and return, extras and cover, then reserve in minutes. A fully interactive demo — nothing is really booked.',
  alternates: { canonical: '/reserve' },
  robots: { index: false, follow: true },
};

export default function ReservePage(): ReactNode {
  return <ReservationWizard />;
}
