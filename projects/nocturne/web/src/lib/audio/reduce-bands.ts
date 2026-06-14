import { SILENT_BANDS, type AudioBands } from '@/lib/schemas';

/**
 * The pure audio band-reduction (Task 3.3, ADR-003 §3).
 *
 * `reduceBands` maps a linear FFT magnitude array (the `AnalyserNode`'s
 * `getByteFrequencyData` output — `Uint8Array` of 0..255) to four
 * frequency-defined bands plus an overall RMS energy, all normalized to [0, 1].
 *
 * `applyEnvelope` smooths a raw band set toward a previous one with per-band
 * attack/release coefficients so the visuals BREATHE, not strobe.
 *
 * Both are PURE — no React, no Web Audio singletons, no module state. The render
 * loop (Pass 2) reads the analyser once per frame, calls `reduceBands`, then
 * feeds the result through `applyEnvelope` holding `prev` in a ref. Fully
 * Vitest-testable with synthetic `Uint8Array` input (Phase 7).
 */

/** Band edges in Hz (ADR-003 §3). Above the top of `high` is folded into high. */
const BAND_EDGES_HZ = {
  subBass: [20, 60],
  bass: [60, 250],
  mid: [250, 2000],
  high: [2000, 8000],
} as const;

/** Clamp a value into [0, 1]. */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * The frequency (Hz) at the centre of FFT bin `i`. Each bin spans
 * `sampleRate / fftSize` Hz; bin `i` covers `[i*w, (i+1)*w)` so its centre is
 * `(i + 0.5) * w`. `frequencyBinCount === fftSize / 2`, so bin indices run
 * `0 .. fftSize/2 - 1` and the top representable frequency is the Nyquist
 * (`sampleRate / 2`).
 */
function binCenterHz(i: number, sampleRate: number, fftSize: number): number {
  const binWidth = sampleRate / fftSize;
  return (i + 0.5) * binWidth;
}

/**
 * Reduce a linear FFT magnitude array to normalized bands.
 *
 * @param freqData  the analyser bins (0..255 bytes, or any 0..255 numbers).
 * @param sampleRate the `AudioContext.sampleRate` (e.g. 44100).
 * @param fftSize   the analyser `fftSize` (e.g. 2048; `freqData.length` is
 *                  expected to be `fftSize / 2`, but a mismatch is tolerated —
 *                  only the bins present are summed).
 */
export function reduceBands(
  freqData: Uint8Array | readonly number[],
  sampleRate: number,
  fftSize: number,
): AudioBands {
  const n = freqData.length;
  if (n === 0 || sampleRate <= 0 || fftSize <= 0) {
    return { ...SILENT_BANDS };
  }

  let subBassSum = 0;
  let subBassCount = 0;
  let bassSum = 0;
  let bassCount = 0;
  let midSum = 0;
  let midCount = 0;
  let highSum = 0;
  let highCount = 0;

  // RMS over the magnitude spectrum (normalized 0..1 per bin).
  let sqSum = 0;

  const highTop = BAND_EDGES_HZ.high[1];

  for (let i = 0; i < n; i += 1) {
    const raw = freqData[i] ?? 0;
    const v = clamp01(raw / 255);
    sqSum += v * v;

    const hz = binCenterHz(i, sampleRate, fftSize);

    if (hz >= BAND_EDGES_HZ.subBass[0] && hz < BAND_EDGES_HZ.subBass[1]) {
      subBassSum += v;
      subBassCount += 1;
    } else if (hz >= BAND_EDGES_HZ.bass[0] && hz < BAND_EDGES_HZ.bass[1]) {
      bassSum += v;
      bassCount += 1;
    } else if (hz >= BAND_EDGES_HZ.mid[0] && hz < BAND_EDGES_HZ.mid[1]) {
      midSum += v;
      midCount += 1;
    } else if (hz >= BAND_EDGES_HZ.high[0]) {
      // Everything at or above the high-band floor (including >8 kHz) folds in.
      void highTop;
      highSum += v;
      highCount += 1;
    }
  }

  const mean = (sum: number, count: number): number =>
    count > 0 ? clamp01(sum / count) : 0;

  const rms = clamp01(Math.sqrt(sqSum / n));

  return {
    subBass: mean(subBassSum, subBassCount),
    bass: mean(bassSum, bassCount),
    mid: mean(midSum, midCount),
    high: mean(highSum, highCount),
    rms,
  };
}

/**
 * Per-band attack/release smoothing (ADR-003 §3). On a RISING value the fast
 * attack coefficient is used (the field surges quickly on the kick); on a
 * FALLING value the slower release coefficient is used (it eases down
 * musically). The coefficient is frame-rate independent:
 *   `coeff = 1 - exp(-dt / tau)`, then `next = prev + (raw - prev) * coeff`.
 *
 * @param prev    the previous smoothed bands (the render loop holds this in a ref).
 * @param raw     the freshly-reduced bands this frame.
 * @param attack  the attack time constant in SECONDS (small — fast rise).
 * @param release the release time constant in SECONDS (larger — slow fall).
 * @param dt      the frame delta in seconds.
 */
export function applyEnvelope(
  prev: AudioBands,
  raw: AudioBands,
  attack: number,
  release: number,
  dt: number,
): AudioBands {
  // A non-positive dt yields no change; a non-positive tau snaps instantly.
  const coeff = (tau: number): number => {
    if (dt <= 0) return 0;
    if (tau <= 0) return 1;
    return 1 - Math.exp(-dt / tau);
  };
  const attackCoeff = coeff(attack);
  const releaseCoeff = coeff(release);

  const smooth = (p: number, r: number): number => {
    const c = r >= p ? attackCoeff : releaseCoeff;
    return clamp01(p + (r - p) * c);
  };

  return {
    subBass: smooth(prev.subBass, raw.subBass),
    bass: smooth(prev.bass, raw.bass),
    mid: smooth(prev.mid, raw.mid),
    high: smooth(prev.high, raw.high),
    rms: smooth(prev.rms, raw.rms),
  };
}

/** Default envelope time constants (seconds) — tuned further in Pass 2. */
export const DEFAULT_ATTACK_S = 0.045;
export const DEFAULT_RELEASE_S = 0.32;
