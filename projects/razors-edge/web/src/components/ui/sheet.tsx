'use client';

import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Sheet — a slide-in panel built on radix Dialog (Task 3.1, for the mobile
 * nav drawer). The enter/exit transition is pure CSS driven by Radix's
 * `data-state` attribute (ADR-002: component mount/unmount where a
 * `data-state` CSS transition suffices is CSS, not Motion). Radix keeps the
 * node mounted through the close transition, so the slide-out actually
 * plays. Reduced motion is honoured by the global floor in globals.css.
 *
 * Accessibility comes from Radix: focus trap, focus return to the trigger
 * on close, `Escape` to dismiss, scroll-lock, and the labelled
 * title/description wiring.
 */
function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>): ReactNode {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(
  props: ComponentProps<typeof DialogPrimitive.Trigger>,
): ReactNode {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(
  props: ComponentProps<typeof DialogPrimitive.Close>,
): ReactNode {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'right' | 'left';
}): ReactNode {
  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-[state=open]:sheet-overlay-in data-[state=closed]:sheet-overlay-out fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'bg-surface border-border-strong fixed inset-y-0 z-50 flex w-[min(20rem,86vw)] flex-col gap-6 border-l p-6 shadow-2xl outline-none',
          side === 'right' ? 'right-0' : 'left-0 border-r border-l-0',
          'data-[state=open]:sheet-in data-[state=closed]:sheet-out',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="sheet-close-button"
          aria-label="Close menu"
          className="text-fg-muted hover:text-fg focus-visible:ring-ring absolute top-5 right-5 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <XIcon className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactNode {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-fg text-lg', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactNode {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-fg-muted text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetDescription,
};
