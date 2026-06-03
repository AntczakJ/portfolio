'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { BOOK_HREF, NAV_ITEMS } from '@/lib/site-nav';

import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

/**
 * Site header (Task 3.1).
 *
 * Transparent over the hero, gaining a translucent backdrop + a hairline
 * brass-tinted bottom border once the viewer scrolls past the hero. The
 * "scrolled" state is a binary toggle observed via an `IntersectionObserver`
 * on a sentinel at the top of the page — NOT a GSAP scrub (ADR-002 reserves
 * GSAP for scrubbed/timeline scroll; this is a single state observation, the
 * cheap and correct tool for a binary header state, no scroll listener, no
 * layout thrash).
 *
 * The header also tracks the in-view section to drive `aria-current` on the
 * anchor nav, so keyboard and screen-reader users get a real "you are here"
 * signal as they scroll the long-form page.
 *
 * Desktop: inline anchor nav + CTA + theme toggle. Mobile (< md): a
 * `Sheet` drawer with the same nav, fully keyboard-operable (Radix focus
 * trap + Escape + focus return).
 */
export function SiteHeader(): ReactNode {
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Binary "past the hero" toggle via a sentinel — solid first paint
  // (transparent), flips once the sentinel leaves the viewport.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setScrolled(!entry?.isIntersecting);
      },
      { rootMargin: '-72px 0px 0px 0px' },
    );
    io.observe(sentinel);
    return () => {
      io.disconnect();
    };
  }, []);

  // Active-section tracking for aria-current.
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
      <div ref={sentinelRef} aria-hidden="true" className="absolute top-0 h-px w-full" />

      <header
        className={cn(
          'fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500',
          scrolled
            ? 'bg-bg/92 border-b border-[var(--color-edge-glow)]/30 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl backdrop-saturate-150'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-[var(--header-h,4.5rem)] max-w-[80rem] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Razor's Edge — home"
          >
            <Wordmark />
          </Link>

          {/* Desktop nav. */}
          <nav
            aria-label="Primary"
            className="hidden items-center gap-1 md:flex"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.target;
              return (
                <a
                  key={item.target}
                  href={`#${item.target}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'focus-visible:ring-ring relative rounded-sm px-3 py-2 text-sm tracking-wide transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    isActive
                      ? 'text-fg'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {item.label}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-x-3 -bottom-px h-px origin-center bg-[var(--color-edge-glow)] transition-transform duration-300',
                      isActive ? 'scale-x-100' : 'scale-x-0',
                    )}
                  />
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button
              asChild
              className="hidden bg-primary text-primary-foreground hover:bg-primary/90 sm:inline-flex"
            >
              <Link href={BOOK_HREF}>Book a chair</Link>
            </Button>

            {/* Mobile drawer trigger. */}
            <div className="md:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Open menu"
                    className="text-fg"
                  >
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetTitle>
                    <Wordmark />
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    Site navigation
                  </SheetDescription>
                  <nav aria-label="Mobile" className="mt-2 flex flex-col gap-1">
                    {NAV_ITEMS.map((item) => (
                      <SheetClose asChild key={item.target}>
                        <a
                          href={`#${item.target}`}
                          aria-current={
                            activeSection === item.target ? 'true' : undefined
                          }
                          className="focus-visible:ring-ring text-fg-muted hover:text-fg aria-[current]:text-fg border-border flex items-center justify-between border-b py-3 text-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {item.label}
                        </a>
                      </SheetClose>
                    ))}
                  </nav>
                  <SheetClose asChild>
                    <Button
                      asChild
                      size="lg"
                      className="bg-primary text-primary-foreground hover:bg-primary/90 mt-auto"
                    >
                      <Link href={BOOK_HREF}>Book a chair</Link>
                    </Button>
                  </SheetClose>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
