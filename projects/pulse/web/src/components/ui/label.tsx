import * as React from 'react';

import { cn } from '@/lib/cn';

/**
 * A plain semantic `<label>` (no Radix dependency — native `htmlFor`
 * association is fully accessible and keyboard-reachable). Styled to the
 * sovereign tokens; `peer-disabled` dims the label when its control is
 * disabled.
 */
function Label({
  className,
  ...props
}: React.ComponentProps<'label'>): React.ReactNode {
  return (
    // This is a generic, reusable label primitive: callers supply the
    // `htmlFor`/control association (and every Pulse form does). The
    // association is enforced at the call sites, not here.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- generic primitive; association is a caller contract (the root jsx-a11y ruleset that eslint-config-next 16 ships flags it here even though the call sites comply)
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm font-medium text-foreground select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
