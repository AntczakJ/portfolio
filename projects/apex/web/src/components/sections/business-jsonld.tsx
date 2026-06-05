import type { ReactNode } from 'react';

import { LOCATIONS, SHOP } from '@/mocks';
import { SITE_URL } from '@/lib/site-config';

/**
 * AutoRental (schema.org) JSON-LD (Task 5.3 / SEO success criterion).
 *
 * Emits the rental business, its locations, and a price range as structured
 * data — part of the local-business fiction's credibility and a real
 * differentiator vs a template. A SERVER component (no interactivity); the
 * `<script type="application/ld+json">` carries a JSON.stringify of a plain
 * object, so it is CSP-safe (no inline executable script — `type` is not
 * `text/javascript`). Derived entirely from the seeded mock `SHOP` + `LOCATIONS`
 * (deterministic).
 */
export function BusinessJsonLd(): ReactNode {
  const major = (minor: number): number => Math.round(minor / 100);

  const locations = LOCATIONS.filter((loc) =>
    SHOP.locationIds.includes(loc.id),
  );

  const data = {
    '@context': 'https://schema.org',
    '@type': 'AutoRental',
    name: SHOP.name,
    description: SHOP.about,
    url: SITE_URL,
    email: SHOP.supportEmail,
    telephone: SHOP.supportPhone,
    priceRange: `${SHOP.currency} ${String(major(SHOP.priceRangeMinMinor))}-${String(
      major(SHOP.priceRangeMaxMinor),
    )} / day`,
    location: locations.map((loc) => ({
      '@type': 'AutoRental',
      name: `${SHOP.name} ${loc.name}`,
      address: {
        '@type': 'PostalAddress',
        streetAddress: loc.address,
        addressLocality: loc.city,
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: loc.lat,
        longitude: loc.lng,
      },
      openingHours: loc.hours,
    })),
  };

  // Escape `<` (and the closing-tag sequence) so a stray `<` in any catalog
  // string can never break out of the <script> element (P2-2, defence in depth —
  // the data is seeded catalog-only today, but JSON-in-HTML must always escape
  // `<`). `<` is valid JSON and renders identically.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return (
    <script
      type="application/ld+json"
      // Deterministic, server-rendered structured data (not executable script).
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
