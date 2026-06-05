'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { NAV_ITEMS, RESERVE_HREF } from '@/lib/site-nav';

import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

/**
 * Site header (Task 4.1).
 *
 * Per the IA, the header appears/sticks AFTER the hero: it is transparent over
 * the first viewport and gains a translucent surface backdrop + a hairline
 * bottom border once the viewer scrolls past the hero. The "scrolled" state is
 * a single binary observation via an `IntersectionObserver` on a top-of-page
 * sentinel — NOT a GSAP scrub (ADR-002 reserves GSAP for scrubbed/timeline
 * scroll; a binary header state is cheaper and correct as a plain observer, no
 * scroll listener, no layout thrash).
 *
 * It also tracks the in-view section to drive `aria-current` on the anchor nav
 * so keyboard + screen-reader users get a real "you are here" signal down the
 * long-form page.
 *
 * Desktop (>= md): inline anchor nav + theme toggle + the primary "Reserve"
 * CTA. Mobile (< md): a Radix `Dialog` drawer with the same nav, fully
 * keyboard-operable (focus trap + Escape + focus return), plus the toggle and
 * CTA. Mobile-first from 320 px: the header row stays a single line and the
 * drawer holds the nav.
 */
export function SiteHeader(): ReactNode {
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Binary "past the hero" toggle. The sentinel sits at the very top; once it
  // scrolls out under the header band the header gains its backdrop.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setScrolled(!entry?.isIntersecting);
      },
      { rootMargin: '-64px 0px 0px 0px' },
    );
    io.observe(sentinel);
    return () => {
      io.disconnect();
    };
  }, []);

  // Active-section tracking for aria-current. Sections may not all exist yet
  // (Phase 5 adds them); the observer simply watches whichever ids are present.
  useEffect(() => {
    const sections = NAV_ITEMS.map((item) =>
      document.getElementById(item.target),
    ).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    sections.forEach((s) => {
      io.observe(s);
    });
    return () => {
      io.disconnect();
    };
  }, []);

  return (
    <>
      {/* Top-of-page sentinel for the scrolled toggle. */}
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="absolute top-0 h-px w-full"
      />

      <header
        className={cn(
          'fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-500',
          scrolled
            ? 'bg-surface/85 shadow-[0_8px_30px_-18px_rgb(16_21_28/0.35)] backdrop-blur-xl backdrop-saturate-150'
            : 'bg-transparent',
        )}
      >
        <div className="mx-auto flex h-[var(--header-height,4rem)] max-w-[var(--width-content,80rem)] items-center justify-between gap-4 px-[var(--space-gutter,1.25rem)]">
          <Link
            href="/"
            aria-label="APEX — home"
            className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <Wordmark className="text-base sm:text-lg" />
          </Link>

          {/* Desktop nav. */}
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.target;
              return (
                <a
                  key={item.target}
                  href={`#${item.target}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'focus-visible:ring-ring relative rounded-sm px-3 py-2 text-sm font-medium tracking-[var(--tracking-snug)] transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    isActive
                      ? 'text-foreground'
                      : 'text-fg-muted hover:text-foreground',
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-accent absolute inset-x-3 -bottom-px h-px origin-center transition-transform duration-300',
                      isActive ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />

            <Link
              href={RESERVE_HREF}
              className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring hidden h-9 items-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:inline-flex"
            >
              Reserve
            </Link>

            {/* Mobile drawer. */}
            <div className="md:hidden">
              <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Dialog.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Open menu"
                    className="border-border text-foreground hover:border-border-strong focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Menu className="size-5" aria-hidden="true" />
                  </button>
                </Dialog.Trigger>

                <Dialog.Portal>
                  <Dialog.Overlay className="apex-overlay fixed inset-0 z-50 bg-[rgb(16_21_28/0.5)] backdrop-blur-sm" />
                  <Dialog.Content className="bg-surface border-border apex-drawer fixed inset-y-0 right-0 z-50 flex w-[min(88vw,20rem)] flex-col gap-1 border-l p-[var(--space-gutter,1.25rem)] shadow-[var(--shadow-studio)]">
                    <div className="mb-4 flex items-center justify-between">
                      <Dialog.Title className="m-0">
                        <Wordmark className="text-base" />
                      </Dialog.Title>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          aria-label="Close menu"
                          className="border-border text-foreground hover:border-border-strong focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <X className="size-5" aria-hidden="true" />
                        </button>
                      </Dialog.Close>
                    </div>
                    <VisuallyHidden.Root asChild>
                      <Dialog.Description>Site navigation</Dialog.Description>
                    </VisuallyHidden.Root>

                    <nav
                      aria-label="Mobile"
                      className="flex flex-col"
                    >
                      {NAV_ITEMS.map((item) => (
                        <a
                          key={item.target}
                          href={`#${item.target}`}
                          onClick={() => {
                            setMenuOpen(false);
                          }}
                          aria-current={
                            activeSection === item.target ? 'true' : undefined
                          }
                          className="border-border text-fg-muted hover:text-foreground aria-[current]:text-foreground focus-visible:ring-ring flex items-center justify-between border-b py-3.5 text-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {item.label}
                        </a>
                      ))}
                    </nav>

                    <Link
                      href={RESERVE_HREF}
                      onClick={() => {
                        setMenuOpen(false);
                      }}
                      className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring mt-auto inline-flex h-11 items-center justify-center rounded-md px-4 text-base font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      Reserve a car
                    </Link>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          </div>
        </div>

        {/* The brand's signature track-line as the header baseline (D-13) — a
            recurring instance of the motif, legible at rest (a faint accent
            thread) and lit brighter once the header gains its surface. This is
            the considered hairline under the header, not a generic 1px border. */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-px transition-opacity duration-500',
            scrolled ? 'opacity-100' : 'opacity-55',
          )}
          style={{ background: 'var(--gradient-track)' }}
        />
      </header>
    </>
  );
}
