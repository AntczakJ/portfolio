import type { AudioSourceKind, RenderRoute } from '@/lib/schemas';

/**
 * The pure text-alternative builder (ADR-004 §5) — the screen-reader description
 * of what the decorative canvas is currently doing. No React, no DOM; takes the
 * current state and returns a sentence for the `aria-live="polite"` region (and
 * the SSR/no-JS fallback copy). Vitest-covered.
 *
 * The canvas is `aria-hidden`; THIS is how a screen-reader user learns "a
 * luminous particle field drifting to <preset>, reacting to <source>."
 */

/** Human-readable label for an audio source. */
export function sourceLabel(source: AudioSourceKind): string {
  switch (source) {
    case 'builtin':
      return 'a synthesized ambient track';
    case 'mic':
      return 'the live microphone';
    case 'upload':
      return 'your uploaded audio';
    default:
      return 'a synthesized ambient track';
  }
}

export interface DescribeStateInput {
  presetName: string;
  source: AudioSourceKind;
  route: RenderRoute;
  armed: boolean;
  muted: boolean;
}

/**
 * Build the live description of the current field state.
 *
 *   - poster route → the static composed surface description (no live field).
 *   - unarmed → the pre-gesture invitation.
 *   - calm (reduced-motion) → drifting, not reacting.
 *   - live → drifting to <preset>, reacting to <source> (or muted).
 */
export function describeFieldState(input: DescribeStateInput): string {
  const { presetName, source, route, armed, muted } = input;

  if (route === 'poster') {
    return `A static composed still of the NOCTURNE particle field in the ${presetName} preset.`;
  }

  if (!armed) {
    return `The NOCTURNE particle field is paused. Press begin to bring the ${presetName} field to life.`;
  }

  if (route === 'calm') {
    return `A luminous particle field drifting calmly in the ${presetName} preset, with audio reactivity muted for reduced motion.`;
  }

  // live
  if (muted) {
    return `A luminous particle field drifting in the ${presetName} preset, sound muted.`;
  }
  return `A luminous particle field drifting in the ${presetName} preset, reacting to ${sourceLabel(
    source,
  )}.`;
}
