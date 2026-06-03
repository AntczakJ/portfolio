import type { ReactNode } from 'react';

import { SITE_NAME, SITE_URL } from '@/lib/site-config';
import { SERVICES } from '@/mocks/services';
import { SHOP } from '@/mocks/shop';

/**
 * `HairSalon` (a `LocalBusiness` subtype) JSON-LD for the studio
 * (CLAUDE.md § 4 SEO). Built server-side from the `SHOP` mock + the service
 * menu, emitted as a single `<script type="application/ld+json">`.
 *
 * Schema.org day names indexed to the `SHOP.openingHours` tuple (0 = Sunday
 * … 6 = Saturday). The `priceRange` is derived from the live service menu so
 * it stays honest if the menu changes. `geo` comes from the address lat/lng
 * used by the static map; `image` is the OG image so rich results have a
 * picture. This is a clearly-fictional demo business — the README documents
 * the mock boundary.
 */
const SCHEMA_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function ShopJsonLd(): ReactNode {
  const prices = SERVICES.map((s) => s.priceMinor);
  const minPrice = Math.round(Math.min(...prices) / 100);
  const maxPrice = Math.round(Math.max(...prices) / 100);
  const currency = SERVICES[0]?.currency ?? 'PLN';

  const openingHoursSpecification = SHOP.openingHours
    .map((row, weekday) =>
      row
        ? {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: `https://schema.org/${SCHEMA_DAYS[weekday] ?? ''}`,
            opens: row.open,
            closes: row.close,
          }
        : null,
    )
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${SITE_URL}/#business`,
    name: SITE_NAME,
    description: SHOP.tagline,
    url: SITE_URL,
    telephone: SHOP.phone,
    email: SHOP.email,
    image: `${SITE_URL}/opengraph-image`,
    priceRange: `${currency} ${String(minPrice)}–${String(maxPrice)}`,
    currenciesAccepted: currency,
    address: {
      '@type': 'PostalAddress',
      streetAddress: SHOP.address.street,
      addressLocality: SHOP.address.city,
      postalCode: SHOP.address.postalCode,
      addressCountry: SHOP.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: SHOP.address.lat,
      longitude: SHOP.address.lng,
    },
    openingHoursSpecification,
    sameAs: SHOP.socials.map((s) => s.url),
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inject (no user input); escape the
      // `<` to avoid any chance of breaking out of the script element.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
      }}
    />
  );
}
