import { z } from 'zod';

import { audioSourceKindSchema } from './audio-source';

/**
 * The HUD / experience state shape (Task 3.1). The serializable slice of the
 * Zustand store the chrome + the (Pass-2) engine read. Kept as a Zod schema so
 * the store's typed shape and the state-machine tests share one contract.
 */

/** Whether the cinematic intro has been dismissed and the field armed. */
export const armStateSchema = z.enum(['idle', 'armed']);
export type ArmState = z.infer<typeof armStateSchema>;

/** The reduced-motion sub-mode within the calm branch (ADR-004 §2). */
export const motionModeSchema = z.enum([
  'full', // beat-driven, audio-reactive (Tier 1/2)
  'calm', // gentle autonomous drift, reactivity muted (Tier 3-RM default)
  'still', // the static poster (the "Still" toggle / Tier 4)
]);
export type MotionMode = z.infer<typeof motionModeSchema>;

export const hudStateSchema = z.object({
  /** The id of the active preset (validated against the preset registry). */
  presetId: z.string().min(1),
  /** The id the field is cross-fading TOWARD (null when not transitioning). */
  transitioningToId: z.string().min(1).nullable(),
  audioSource: audioSourceKindSchema,
  /** Master mute (gain 0 → field falls to idle drift; ADR-003 §1). */
  muted: z.boolean(),
  armState: armStateSchema,
  motionMode: motionModeSchema,
  /** Whether the pointer/touch wake is enabled (a HUD control). */
  pointerInteraction: z.boolean(),
  /** Whether the auto-dimming HUD is currently dimmed (opacity-only). */
  hudDimmed: z.boolean(),
});
export type HudState = z.infer<typeof hudStateSchema>;
