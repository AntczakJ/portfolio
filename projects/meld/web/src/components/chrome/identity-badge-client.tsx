'use client';

import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useMemo, useRef } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import {
  type InitialIdentity,
  useIdentity,
} from '@/lib/identity/use-identity';

/**
 * Client wrapper for the brand-corner identity badge (Task 2.5b).
 *
 * Reads from {@link useIdentity} which composes the SSR `initial` prop
 * with the live welcome-store state. Two render states, one component:
 *
 *   - Pre-welcome (initial only): emoji + name visible, ring uses the
 *     neutral `--color-fg-muted` token. No color is known yet because
 *     the awareness color is per-board and ships via WS.
 *
 *   - Post-welcome: ring fades to the resolved OKLCH color
 *     (`session.color` light, `session.colorDark` dark) over 320 ms
 *     with `easeOutCubic`. `prefers-reduced-motion` snaps instantly.
 *     The light/dark switch piggybacks on the existing `data-theme`
 *     attribute via CSS variables on the wrapper element so we do not
 *     subscribe to next-themes from inside this component.
 *
 *   - Anonymous fallback (no initial, no welcome): a monospace em-dash
 *     in the name slot, no emoji, neutral color, no tooltip. The
 *     accessible name names the state ("anonymous session") so a
 *     screen-reader user understands the chrome is in a degraded
 *     state.
 *
 * Tooltip carries the short id fingerprint — first 8 chars of the
 * UUID v4 followed by an ellipsis. A recruiter hovering reads "Your
 * session: 4d520148…" which, paired with the WS welcome frame visible
 * in the DevTools Network panel, gives the wire-truth in one glance.
 *
 * Hydration safety: the server render and the first client render
 * MUST match. We achieve that by reading `initial` synchronously on
 * the first render (Zustand store still empty) — both the server and
 * the client render the same emoji + name + neutral ring. Once
 * Task 2.5a fires `setWelcome(...)`, the store mutates and the next
 * client render replaces the neutral ring with the live color. No
 * `useEffect`-gated render fork.
 */

/**
 * Welcome-arrival ring beat (Phase 4.3 D-02 fix).
 *
 *   - Duration 280 ms — matches rauno.me's dim-state→live-state
 *     window and Linear's collaborator-joined pop.
 *   - Curve `[0.16, 1, 0.3, 1]` — the Material decel curve, calmer
 *     than `easeOutCubic` and reads as "earned" rather than
 *     "bouncy".
 *   - Scale 0.97 → 1 — a single perceptual frame of growth that
 *     telegraphs the identity resolving without distracting from
 *     the surrounding chrome.
 *   - `borderColor` animated through Motion's color interpolator
 *     so the OKLCH ramp is perceptible (was: instant CSS
 *     `transition-colors`).
 *
 * Reduced-motion short-circuits to `{ duration: 0 }` — the welcome
 * still resolves, the beat is just instant.
 */
const RING_BEAT_DURATION_MS = 280;
const RING_BEAT_CURVE = [0.16, 1, 0.3, 1] as const;
const NEUTRAL_BORDER = 'var(--color-fg-muted)';

function shortId(id: string): string {
  // First 8 chars of a UUID v4 are unique enough to disambiguate two
  // active sessions at a glance, short enough to fit a tooltip line.
  return `${id.slice(0, 8)}…`;
}

function oklchString(color: { L: number; C: number; H: number }): string {
  // OKLCH triples ship with capitalised keys on the wire; the CSS
  // `oklch()` function takes them positionally. Keep precision modest
  // so the rendered style string is grep-friendly in DevTools.
  return `oklch(${color.L.toFixed(3)} ${color.C.toFixed(3)} ${color.H.toFixed(2)})`;
}

interface IdentityBadgeClientProps {
  initial: InitialIdentity | null;
}

export function IdentityBadgeClient({
  initial,
}: IdentityBadgeClientProps): ReactNode {
  const identity = useIdentity(initial);
  const reduceMotion = useReducedMotion();

  // Pre-compute the ring color the wrapper element renders. CSS handles
  // the light/dark theme switch via a `--badge-ring` custom property
  // that we set on the wrapper itself; light theme reads from `color`,
  // dark theme reads from `colorDark` via the `data-theme="dark"`
  // override at the bottom of this file's class composition.
  const ringStyle = useMemo<Record<string, string>>(() => {
    if (!identity?.color || !identity.colorDark) {
      return {
        '--badge-ring': 'var(--color-fg-muted)',
        '--badge-ring-dark': 'var(--color-fg-muted)',
      };
    }
    return {
      '--badge-ring': oklchString(identity.color),
      '--badge-ring-dark': oklchString(identity.colorDark),
    };
  }, [identity?.color, identity?.colorDark]);

  // Light-mode resolved color for the Motion `borderColor` ramp.
  // Motion interpolates between OKLCH strings frame-by-frame, so the
  // welcome-arrival beat shows a perceptible color ramp instead of the
  // CSS `transition-colors` flat swap. Dark mode rides on the
  // `--badge-ring-dark` CSS variable via the `dark:border-…` class
  // composition below — Motion does NOT animate the dark variant
  // directly (it would require subscribing to next-themes from inside
  // this component, which the hydration model rejects).
  const ringColorResolved = identity?.color
    ? oklchString(identity.color)
    : NEUTRAL_BORDER;

  // Track the previous color-resolved state so the welcome-arrival
  // beat fires exactly once per `null → resolved` transition. Without
  // this, Motion re-animates on every render where `animate` changes
  // referentially, which is fine for borderColor but would re-pulse
  // the scale beat every time the consumer re-renders.
  const beatFiredRef = useRef(false);
  const hasColor = identity?.color !== null && identity?.color !== undefined;
  const shouldFireBeat = hasColor && !beatFiredRef.current;
  if (hasColor) {
    beatFiredRef.current = true;
  }

  // Anonymous fallback render — `initial === null` AND no welcome.
  if (!identity) {
    return (
      <span
        role="status"
        aria-label="Your session identity: anonymous"
        data-testid="identity-badge"
        data-identity-state="anonymous"
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full',
          'bg-(--color-surface) px-2 text-xs',
          'border border-(--color-border)',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-5 w-5 items-center justify-center rounded-full',
            'border border-(--color-fg-muted) text-(--color-fg-muted)',
          )}
        >
          {/* No emoji — explicit em-dash in the ring slot signals
              "identity unknown". */}
          <span className="font-mono text-[10px] leading-none">—</span>
        </span>
        <span className="font-mono text-(--color-fg-muted)">anonymous</span>
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={`Your session identity: ${identity.emojiName}`}
          data-testid="identity-badge"
          data-identity-name={identity.emojiName}
          data-identity-id={identity.id}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full',
            'bg-(--color-surface) px-2 text-xs',
            'border border-(--color-border)',
            // Tooltip trigger must be focusable for keyboard hover.
            'cursor-default focus-visible:outline-2',
          )}
          style={ringStyle}
          tabIndex={0}
          data-mintedAt={identity.mintedAt ?? 'initial'}
        >
          <motion.span
            aria-hidden="true"
            // Welcome-arrival beat — scale 0.97 → 1 + Motion
            // `borderColor` ramp through the OKLCH space (Phase 4.3
            // D-02). `initial` snaps pre-welcome to the neutral
            // border + 0.97 scale ONLY on the first ever fire of the
            // beat; subsequent renders skip `initial` so the badge
            // does not re-pulse on unrelated re-renders. Dark-mode
            // color rides on the `--badge-ring-dark` CSS variable
            // via the class composition below — Motion drives only
            // the light-mode interpolation.
            initial={
              shouldFireBeat
                ? { scale: 0.97, borderColor: NEUTRAL_BORDER }
                : false
            }
            animate={{ scale: 1, borderColor: ringColorResolved }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: RING_BEAT_DURATION_MS / 1000,
                    ease: RING_BEAT_CURVE,
                  }
            }
            className={cn(
              'inline-flex h-5 w-5 items-center justify-center rounded-full',
              'border-2 border-(--badge-ring)',
              // Dark theme override — the wrapper sets both
              // --badge-ring and --badge-ring-dark; the dark-theme
              // selector swaps the consumed variable so the same
              // class composition paints with the dark color.
              'dark:border-(--badge-ring-dark)',
              "[[data-theme='dark']_&]:border-(--badge-ring-dark)",
            )}
          >
            <span className="text-[13px] leading-none">
              {identity.emojiChar}
            </span>
          </motion.span>
          <span className="font-mono text-(--color-fg)">
            {identity.emojiName}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <span className="flex flex-col gap-0.5">
          <span>Your session</span>
          <span className="font-mono text-[10px] opacity-80">
            {shortId(identity.id)}
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
