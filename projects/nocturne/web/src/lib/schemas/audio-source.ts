import { z } from 'zod';

/**
 * The audio-source kind (ADR-003 §1). Three sources feed one shared
 * `AnalyserNode`: the bundled CC0 track (default), the live microphone, and a
 * user-uploaded local file. This is the discriminant the HUD source-picker and
 * the (Pass-2) audio graph switch on.
 */
export const audioSourceKindSchema = z.enum(['builtin', 'mic', 'upload']);

export type AudioSourceKind = z.infer<typeof audioSourceKindSchema>;

/** The set of source kinds, ordered for the HUD picker. */
export const AUDIO_SOURCE_KINDS = audioSourceKindSchema.options;
