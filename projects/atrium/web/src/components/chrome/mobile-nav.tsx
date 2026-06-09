'use client';

import { Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/cn';
import {
  DIRECTORY_NAV_ITEM,
  PROJECT_NAV_ITEMS,
  type NavItem,
} from '@/lib/site-nav';

/**
 * The mobile navigation drawer (Task 3.1) — the accessible collapse of the
 * centre nav below the desktop breakpoint.
 *
 * Built on Radix Dialog, so it inherits a focus trap, `Escape`-to-close, scroll
 * lock, an `aria-modal` labelled dialog, and focus restoration to the trigger for
 * free — the accessibility floor WCAG 2.2 AA requires, without hand-rolling it.
 * The enter/exit is CSS keyed off Radix `data-state` (the `[data-atrium-sheet]` /
 * `[data-atrium-overlay]` keyframes in globals.css) — NO Motion (ADR-002). Radix
 * keeps the node mounted through the exit animation, so the slide-out completes
 * before unmount with pure CSS.
 *
 * Each nav link closes the sheet on activation (so the page can scroll to the
 * anchor) via controlled `open` state. Links are real `<a href="#…">` — keyboard
 * reachable, and they work with JS disabled too (the trigger button is the only
 * JS-only affordance, and the desktop nav + the directory cover no-JS reach).
 */

const ITEMS: readonly NavItem[] = [...PROJECT_NAV_ITEMS, DIRECTORY_NAV_ITEM];

export function MobileNav({ className }: { className?: string }): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open navigation menu"
        className={cn(
          'border-border-strong text-fg-muted hover:text-fg hover:border-light/60 inline-flex size-9 items-center justify-center rounded-md border bg-transparent transition-colors',
          className,
        )}
      >
        <Menu aria-hidden className="size-4" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-atrium-overlay
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        />
        <DialogPrimitive.Content
          data-atrium-sheet
          aria-describedby={undefined}
          className="bg-surface border-border-strong fixed inset-y-0 right-0 z-50 flex w-[min(88vw,20rem)] flex-col border-l shadow-2xl"
        >
          <div className="border-border flex items-center justify-between border-b px-6 py-4">
            <DialogPrimitive.Title className="font-display text-fg text-sm font-semibold tracking-wide uppercase">
              Navigate
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close navigation menu"
              className="text-fg-muted hover:text-fg inline-flex size-9 items-center justify-center rounded-md transition-colors"
            >
              <X aria-hidden className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <nav aria-label="Project navigation" className="flex-1 overflow-y-auto px-3 py-4">
            <ul className="flex flex-col">
              {ITEMS.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-label={item.ariaLabel ?? item.label}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="text-fg-muted hover:text-fg hover:bg-accent flex items-center justify-between rounded-md px-3 py-3 text-base transition-colors"
                  >
                    <span className="font-display tracking-tight">{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
