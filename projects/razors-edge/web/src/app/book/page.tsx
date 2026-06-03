import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { BookingWizard } from '@/components/booking/booking-wizard';

/**
 * `/book` — the booking wizard (Phase 4b, Tasks 4.5–4.7).
 *
 * A STATIC route shell: it does not read `searchParams` on the server (which
 * would make the route dynamic and stream the resolved `<meta>` tags into the
 * body behind a Suspense boundary — Lighthouse then reports the
 * meta-description "missing" because it reads the head). Instead the route is
 * static so its metadata is fully resolved in the head, and the deep-link
 * preselect (`?service=`/`?barber=`) is read client-side by the wizard via
 * `useSearchParams` and validated against the mock catalog there (unknown ids
 * are ignored per ADR-003).
 *
 * The wizard itself is inherently interactive (Zustand machine + Motion step
 * transitions + the availability grid), so the rich flow is client-side — but
 * the route never shows a blank screen: a `<noscript>` fallback explains the
 * flow and offers the studio's phone for a no-JS client, and the wizard
 * renders an on-brand skeleton before hydration.
 */
const BOOK_DESCRIPTION =
  'Book your chair at Razor’s Edge — choose a service, a barber, and a time, then confirm. A demo booking flow; no real appointment is made.';

export const metadata: Metadata = {
  title: 'Book a chair',
  description: BOOK_DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: '/book' },
  openGraph: {
    type: 'website',
    url: '/book',
    title: 'Book a chair — Razor’s Edge',
    description: BOOK_DESCRIPTION,
    siteName: "Razor's Edge",
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Book a chair — Razor’s Edge',
    description: BOOK_DESCRIPTION,
  },
};

export default function BookPage(): ReactNode {
  return (
    <>
      <noscript>
        <div className="mx-auto max-w-2xl px-5 py-32 text-center sm:px-8">
          <h1 className="font-display text-fg text-[length:var(--text-h1)]">
            Book a chair
          </h1>
          <p className="text-fg-muted mt-4">
            Our booking flow needs JavaScript. To book without it, call the
            studio on{' '}
            <a className="text-brass-text underline" href="tel:+48225550190">
              +48 22 555 01 90
            </a>{' '}
            or browse the services on the{' '}
            {/* next/link renders a real <a href="/"> in the SSR HTML, so it
                navigates on a full page load without JS — valid in <noscript>. */}
            <Link className="text-brass-text underline" href="/">
              home page
            </Link>
            . This is a demo — no real appointment is made.
          </p>
        </div>
      </noscript>

      <BookingWizard />
    </>
  );
}
