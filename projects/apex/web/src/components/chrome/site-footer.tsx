import Link from 'next/link';
import type { ReactNode } from 'react';

import { LOCATIONS, SHOP } from '@/mocks';
import { NAV_ITEMS, RESERVE_HREF } from '@/lib/site-nav';

import {
  FacebookGlyph,
  InstagramGlyph,
  TikTokGlyph,
  XGlyph,
} from './brand-icons';
import { TrackLine } from './track-line';
import { Wordmark } from './wordmark';

/**
 * Site footer shell (Task 4.1).
 *
 * A designed brand surface (PLAN.md IA §9), NOT a sitemap dump: the wordmark +
 * tagline, the anchor nav, the rental locations (driven off `LOCATIONS` filtered
 * by `SHOP.locationIds`), hours + support, social glyphs (hand-rolled SVGs —
 * lucide v1.16 dropped brand icons), a final "Reserve" CTA, and a legal /
 * credits line. The credits line carries a clean, visitor-facing provenance
 * note ("3D & imagery: studio renders"); the full build/provenance notes
 * (placeholder-GLB license flag, generated-asset swap-for-real paths) live in
 * CREDITS.md, NOT in the live UI (A-04). A server component (no interactivity).
 */
export function SiteFooter(): ReactNode {
  const year = 2026; // frozen-clock era (src/lib/clock.ts now = 2026) — no Date.now()

  const footerLocations = LOCATIONS.filter((loc) =>
    SHOP.locationIds.includes(loc.id),
  );

  const socials: readonly {
    href: string | undefined;
    label: string;
    Glyph: typeof InstagramGlyph;
  }[] = [
    { href: SHOP.social.instagram, label: 'Instagram', Glyph: InstagramGlyph },
    { href: SHOP.social.facebook, label: 'Facebook', Glyph: FacebookGlyph },
    { href: SHOP.social.tiktok, label: 'TikTok', Glyph: TikTokGlyph },
    { href: SHOP.social.x, label: 'X', Glyph: XGlyph },
  ];

  return (
    <footer
      id="footer"
      className="bg-surface border-border relative border-t"
    >
      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-16 sm:py-20">
        {/* Brand row + final CTA. */}
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-md">
            <Wordmark className="text-xl" />
            <p className="text-fg-muted mt-4 text-[length:var(--text-lg)] text-balance">
              {SHOP.tagline}
            </p>
            <p className="text-fg-subtle mt-3 max-w-sm text-sm leading-[var(--leading-normal)]">
              {SHOP.about}
            </p>
          </div>

          <Link
            href={RESERVE_HREF}
            className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-12 shrink-0 items-center justify-center rounded-md px-7 text-base font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Reserve a car
          </Link>
        </div>

        <TrackLine className="my-12" behavior="static" />

        {/* Link columns. */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
          <nav aria-label="Footer" className="flex flex-col gap-3">
            <h2 className="text-fg-subtle text-[length:var(--text-xs)] tracking-[var(--tracking-wider)] uppercase">
              Explore
            </h2>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.target}
                href={`#${item.target}`}
                className="text-fg-muted hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {item.label}
              </a>
            ))}
            <Link
              href={RESERVE_HREF}
              className="text-fg-muted hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              Reserve
            </Link>
          </nav>

          <div className="flex flex-col gap-3">
            <h2 className="text-fg-subtle text-[length:var(--text-xs)] tracking-[var(--tracking-wider)] uppercase">
              Locations
            </h2>
            {footerLocations.map((loc) => (
              <span key={loc.id} className="text-fg-muted text-sm">
                {loc.name}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-fg-subtle text-[length:var(--text-xs)] tracking-[var(--tracking-wider)] uppercase">
              Support
            </h2>
            <a
              href={`mailto:${SHOP.supportEmail}`}
              className="text-fg-muted hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {SHOP.supportEmail}
            </a>
            <a
              href={`tel:${SHOP.supportPhone.replace(/\s+/g, '')}`}
              className="text-fg-muted hover:text-foreground focus-visible:ring-ring w-fit rounded-sm text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {SHOP.supportPhone}
            </a>
            <span className="text-fg-subtle text-sm">{SHOP.hours}</span>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-fg-subtle text-[length:var(--text-xs)] tracking-[var(--tracking-wider)] uppercase">
              Follow
            </h2>
            <div className="flex items-center gap-2">
              {socials
                .filter((s) => s.href)
                .map(({ href, label, Glyph }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`APEX on ${label}`}
                    className="border-border text-fg-muted hover:text-foreground hover:border-border-strong focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Glyph className="size-4" />
                  </a>
                ))}
            </div>
          </div>
        </div>

        {/* Legal + credits line (Task 5.3). The 3D-model + imagery provenance is
            filled in honestly here; CREDITS.md is the full source of truth. */}
        <div className="border-border text-fg-subtle mt-12 flex flex-col gap-2 border-t pt-6 text-[length:var(--text-2xs)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} {SHOP.name}. A portfolio showcase by Jan Antczak —
            this is a demo; no car is actually booked.
          </p>
          <p>
            3D &amp; imagery: APEX studio renders. Type set in Inter &amp; Space
            Grotesk. Full provenance in CREDITS.md.
          </p>
        </div>
      </div>
    </footer>
  );
}
