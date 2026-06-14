import { z } from 'zod';

/**
 * The audio analysis output shape (ADR-003 §3). The pure `reduceBands` function
 * maps the linear FFT bins to these four frequency bands plus an overall energy
 * envelope; `applyEnvelope` smooths them frame to frame. All values are
 * normalized to [0, 1]. This is the contract the engine uniforms consume:
 *   bass → turbulence/flow-energy, mid → spread, high → colour-shift/sparkle,
 *   rms → bloom/vignette breathing (ADR-002 §3 / ADR-003 §4).
 */
const unit = z.number().min(0).max(1);

export const audioBandsSchema = z.object({
  /** ~20–60 Hz — the lowest rumble. */
  subBass: unit,
  /** ~60–250 Hz — the kick / bass drive (surges the field). */
  bass: unit,
  /** ~250–2000 Hz — the body / motion band. */
  mid: unit,
  /** ~2000–8000 Hz (and above, folded in) — the shimmer / sparkle band. */
  high: unit,
  /** Overall loudness envelope (root-mean-square across the bins). */
  rms: unit,
});

export type AudioBands = z.infer<typeof audioBandsSchema>;

/** A zeroed band set — silence; the identity input for the envelope. */
export const SILENT_BANDS: AudioBands = {
  subBass: 0,
  bass: 0,
  mid: 0,
  high: 0,
  rms: 0,
};
