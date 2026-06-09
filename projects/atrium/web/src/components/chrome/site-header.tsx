'use client';

import { Mail } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { AUTHOR_EMAIL } from '@/lib/site-config';
import {
  DIRECTORY_NAV_ITEM,
  OBSERVED_SECTION_IDS,
  PROJECT_NAV_ITEMS,
} from '@/lib/site-nav';

import { BrandMark } from './brand-mark';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';

/**
 * The persistent, post-hero sticky header (Task 3.1).
 *
 * Two binary scroll STATES, both driven by `IntersectionObserver` — NOT GSAP
 * (ADR-002: state observation is not scroll animation; the razors-edge header
 * precedent):
 *
 *   1. `revealed` — the header is invisible/raised while the hero fills the
 *      viewport and slides in once the hero scrolls past, so the cinematic first
 *      paint (the wordmark in the shaft) is uninterrupted. A sentinel at the end
 *      of the hero toggles this.
 *   2. `aria-current` — the nav item for the section currently in view is marked
 *      `aria-current="true"` and visually lit. One observer over the six bays +
 *      the directory picks the topmost intersecting section.
 *
 * Everything else is real, focusable DOM: the brand mark (left, links to `#top`),
 * the six project anchors + the directory (centre, collapsing to `MobileNav`
 * below `md`), the theme toggle, and a `mailto:` contact affordance (right). The
 * nav is a real `<nav>` with `<a href="#…">` links, so it works with JS disabled
 * (only the reveal animation and `aria-current` are progressive enhancement; the
 * links and the header content are server-equivalent DOM).
 *
 * The header is rendered once in the layout shell, above the light field and the
 * scroll content.
 */

/**
 * The DOM id of the hero-base sentinel the reveal observer watches. The page
 * renders an element with this id in document flow immediately after the hero
 * (see `app/page.tsx`), so when it crosses the top of the viewport the header
 * reveals. The header looks it up by id rather than owning it, so the header can
 * stay `fixed` at the top of the viewport while its observation target lives at
 * the base of the hero in the scroll flow.
 */
export const HERO_SENTINEL_ID = 'hero-sentinel';

export function SiteHeader(): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Reveal observer: a sentinel placed in document flow at the bottom of the
  // hero. While the sentinel is in view (hero on screen) the header stays hidden;
  // once it scrolls out the top, the header reveals. Robust to no-IO: if
  // unsupported, the header simply shows (the static, always-usable fallback).
  useEffect(() => {
    const sentinel = document.getElementById(HERO_SENTINEL_ID);
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Reveal when the sentinel has left the viewport upward (hero scrolled
        // past). `boundingClientRect.top < 0` distinguishes "scrolled past above"
        // from "not yet reached below".
        if (!entry) return;
        const scrolledPast =
          !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setRevealed(scrolledPast);
      },
      { rootMargin: '0px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, []);

  // aria-current observer: track which observed section is the topmost one in
  // view. We keep a live set of intersecting ids and pick the first in document
  // order, so the lit nav item matches the section the viewer is reading.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const topmost = OBSERVED_SECTION_IDS.find((id) => visible.has(id));
        setCurrentId(topmost ?? null);
      },
      // A band across the vertical middle of the viewport: a section is "current"
      // while its content crosses the centre, which matches the pinned-bay read.
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    for (const id of OBSERVED_SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  const navItems = [...PROJECT_NAV_ITEMS, DIRECTORY_NAV_ITEM];

  return (
    <header
        className={cn(
          'fixed inset-x-0 top-0 z-40 transition-[transform,opacity,background-color,backdrop-filter] duration-500',
          revealed
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-full opacity-0',
        )}
      >
        {/* Backdrop: a translucent, blurred warm field that only materialises
            once revealed, so the chrome reads as a calm lit lintel over the
            scroll, never a hard bar over the hero. */}
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 -z-10 border-b transition-colors duration-500',
            revealed
              ? 'bg-bg/72 border-border supports-[backdrop-filter]:bg-bg/55 backdrop-blur-md'
              : 'border-transparent bg-transparent',
          )}
        />

        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <BrandMark />

          {/* Centre nav — desktop only; collapses to the drawer below md. */}
          <nav
            aria-label="Primary"
            className="hidden flex-1 items-center justify-center md:flex"
          >
            <ul className="flex items-center gap-1">
              {navItems.map((item) => {
                const isCurrent = currentId === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-label={item.ariaLabel ?? item.label}
                      aria-current={isCurrent ? 'true' : undefined}
                      className={cn(
                        'font-display relative rounded-sm px-3 py-2 text-sm tracking-tight transition-colors',
                        isCurrent
                          ? 'text-light-strong'
                          : 'text-fg-muted hover:text-fg',
                      )}
                    >
                      {item.label}
                      {/* The lit underline marks the current section. */}
                      <span
                        aria-hidden
                        className={cn(
                          'bg-light absolute inset-x-3 -bottom-px h-px origin-center transition-transform duration-300',
                          isCurrent ? 'scale-x-100' : 'scale-x-0',
                        )}
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={`mailto:${AUTHOR_EMAIL}`}
              className="border-border-strong text-fg-muted hover:text-fg hover:border-light/60 hidden items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors sm:inline-flex"
            >
              <Mail aria-hidden className="size-4" />
              <span>Contact</span>
            </a>
            <ThemeToggle />
            <MobileNav className="md:hidden" />
          </div>
        </div>
      </header>
  );
}
