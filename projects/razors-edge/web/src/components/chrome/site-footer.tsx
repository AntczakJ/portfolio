import Link from 'next/link';
import type { ReactNode } from 'react';

import { todayISODate, weekdayOfISODate } from '@/lib/clock';
import { cn } from '@/lib/cn';
import { hhmmToMinutes, minutesToHHMM } from '@/lib/schemas/common';
import { BOOK_HREF, NAV_ITEMS } from '@/lib/site-nav';
import { SHOP } from '@/mocks';

import { BladeSweepDivider } from './blade-sweep-divider';
import { FacebookGlyph, InstagramGlyph, TikTokGlyph } from './brand-icons';
import { Logomark } from './wordmark';

/**
 * Footer (Task 4.4) — promoted from the Phase 3 stub to the full designed
 * footer: brand lockup + positioning, the anchor nav repeated, a compact
 * hours summary (with today highlighted via the frozen clock), socials, a
 * final "Book a chair" CTA, and the honest "demo — no real appointments"
 * line. A designed brand surface, not a sitemap dump (PLAN.md § Footer).
 *
 * Server Component — all data is static (`SHOP` / nav) + the frozen clock;
 * no interactivity. "Today" is deterministic (frozen now, ADR-003).
 */
const SHORT_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function SiteFooter(): ReactNode {
  const year = 2026; // frozen-now world (ADR-003) — no Date.now() in render.
  const todayWeekday = weekdayOfISODate(todayISODate());

  return (
    <footer className="relative mt-auto">
      <BladeSweepDivider className="py-px" weight="bold" />
      <div className="mx-auto max-w-[80rem] px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1.4fr_1fr_1fr] md:gap-10">
          {/* Brand. */}
          <div className="max-w-sm">
            <Link
              href="/"
              className="focus-visible:ring-ring inline-flex items-center gap-2.5 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
              aria-label="Razor's Edge — home"
            >
              <Logomark className="text-fg h-7 w-7" />
              <span className="font-display text-fg text-2xl tracking-tight [font-variation-settings:'opsz'_72,'wght'_520,'SOFT'_0]">
                Razor&rsquo;s Edge
              </span>
            </Link>
            <p className="text-fg-muted mt-5 text-balance leading-relaxed">
              {SHOP.tagline}
            </p>
            <p className="text-fg-subtle mt-3 text-sm">
              {SHOP.address.street}, {SHOP.address.postalCode}{' '}
              {SHOP.address.city}
            </p>
            <ul className="mt-6 flex items-center gap-2">
              {SHOP.socials.map((social) => {
                const Icon =
                  social.platform === 'instagram'
                    ? InstagramGlyph
                    : social.platform === 'facebook'
                      ? FacebookGlyph
                      : social.platform === 'tiktok'
                        ? TikTokGlyph
                        : null;
                if (!Icon) return null;
                return (
                  <li key={social.platform}>
                    <a
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${SHOP.name} on ${social.platform}`}
                      className="group text-fg-muted hover:text-brass-text focus-visible:ring-ring border-border bg-surface/30 hover:border-border-strong relative flex size-10 items-center justify-center overflow-hidden rounded-md border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Icon className="size-[1.05rem]" />
                      {/* Brand drawn-edge under-line on hover (D-12) — the
                          razor's lit edge, not a generic thin circle. */}
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-px origin-center scale-x-0 bg-[var(--color-edge-glow)] transition-transform duration-300 group-hover:scale-x-100"
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Nav. */}
          <nav aria-label="Footer">
            <h3 className="text-fg-subtle text-[length:var(--text-caption)] tracking-[0.2em] uppercase">
              Explore
            </h3>
            <ul className="mt-5 flex flex-col gap-3">
              {NAV_ITEMS.map((item) => (
                <li key={item.target}>
                  <a
                    href={`#${item.target}`}
                    className="group focus-visible:ring-ring text-fg-muted hover:text-fg inline-flex items-center gap-2 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      className="h-px w-0 bg-[var(--color-edge-glow)] transition-all duration-300 group-hover:w-4"
                    />
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link
                  href={BOOK_HREF}
                  className="group focus-visible:ring-ring text-brass-text inline-flex items-center gap-2 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className="h-px w-4 bg-[var(--color-edge-glow)] transition-all duration-300 group-hover:w-6"
                  />
                  Book a chair
                </Link>
              </li>
            </ul>
          </nav>

          {/* Hours summary. */}
          <div>
            <h3 className="text-fg-subtle text-[length:var(--text-caption)] tracking-[0.2em] uppercase">
              Hours
            </h3>
            <ul className="mt-5 flex flex-col gap-2 text-sm">
              {SHOP.openingHours.map((row, weekday) => {
                const isToday = weekday === todayWeekday;
                return (
                  <li
                    key={weekday}
                    className={cn(
                      'flex items-center justify-between gap-4',
                      isToday ? 'text-fg' : 'text-fg-muted',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {SHORT_WEEKDAY[weekday]}
                      {isToday ? (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-[var(--color-edge-glow)]"
                        />
                      ) : null}
                    </span>
                    <span className="tabular-nums">
                      {row === null
                        ? 'Closed'
                        : `${minutesToHHMM(hhmmToMinutes(row.open))}–${minutesToHHMM(hhmmToMinutes(row.close))}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="border-border text-fg-subtle mt-14 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} Razor&rsquo;s Edge. A portfolio demo — no real
            appointments are scheduled.
          </p>
          <p className="tracking-wide">Designed &amp; built by Jan Antczak.</p>
        </div>
      </div>
    </footer>
  );
}
