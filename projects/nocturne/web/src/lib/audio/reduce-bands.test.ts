import { describe, expect, it } from 'vitest';

import { SILENT_BANDS } from '@/lib/schemas';

import {
  applyEnvelope,
  DEFAULT_ATTACK_S,
  DEFAULT_RELEASE_S,
  reduceBands,
} from './reduce-bands';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const BIN_COUNT = FFT_SIZE / 2; // 1024 bins
const BIN_WIDTH = SAMPLE_RATE / FFT_SIZE; // ~21.5 Hz

/** Build a 1024-bin array, optionally hot in a [loHz, hiHz) range. */
function bins(value: number, range?: [number, number]): Uint8Array {
  const out = new Uint8Array(BIN_COUNT);
  for (let i = 0; i < BIN_COUNT; i += 1) {
    const hz = (i + 0.5) * BIN_WIDTH;
    if (!range) {
      out[i] = value;
    } else if (hz >= range[0] && hz < range[1]) {
      out[i] = value;
    }
  }
  return out;
}

describe('reduceBands', () => {
  it('returns all-zero bands for silence', () => {
    const result = reduceBands(bins(0), SAMPLE_RATE, FFT_SIZE);
    expect(result).toEqual(SILENT_BANDS);
  });

  it('returns near-full bands for a full-scale spectrum', () => {
    const result = reduceBands(bins(255), SAMPLE_RATE, FFT_SIZE);
    expect(result.subBass).toBeCloseTo(1, 5);
    expect(result.bass).toBeCloseTo(1, 5);
    expect(result.mid).toBeCloseTo(1, 5);
    expect(result.high).toBeCloseTo(1, 5);
    expect(result.rms).toBeCloseTo(1, 5);
  });

  it('isolates a bass-only spike', () => {
    const result = reduceBands(bins(255, [60, 250]), SAMPLE_RATE, FFT_SIZE);
    expect(result.bass).toBeCloseTo(1, 5);
    expect(result.subBass).toBe(0);
    expect(result.mid).toBe(0);
    expect(result.high).toBe(0);
    // rms is non-zero (the bass bins contribute) but well below 1.
    expect(result.rms).toBeGreaterThan(0);
    expect(result.rms).toBeLessThan(0.5);
  });

  it('isolates a high-only spike and folds >8kHz up to Nyquist into high', () => {
    // Everything at or above 2 kHz (up to the ~22.05 kHz Nyquist) folds into
    // `high`, so to drive the high mean to ~1 the whole high tail must be hot.
    const result = reduceBands(bins(255, [2000, 25000]), SAMPLE_RATE, FFT_SIZE);
    expect(result.high).toBeCloseTo(1, 5);
    expect(result.bass).toBe(0);
    expect(result.mid).toBe(0);
  });

  it('still classifies a spike in the 8–22kHz tail as high (the fold-in)', () => {
    const result = reduceBands(bins(255, [9000, 12000]), SAMPLE_RATE, FFT_SIZE);
    expect(result.high).toBeGreaterThan(0);
    expect(result.mid).toBe(0);
    expect(result.bass).toBe(0);
  });

  it('handles empty bins gracefully', () => {
    expect(reduceBands(new Uint8Array(0), SAMPLE_RATE, FFT_SIZE)).toEqual(
      SILENT_BANDS,
    );
  });

  it('handles non-positive sampleRate/fftSize gracefully', () => {
    expect(reduceBands(bins(255), 0, FFT_SIZE)).toEqual(SILENT_BANDS);
    expect(reduceBands(bins(255), SAMPLE_RATE, 0)).toEqual(SILENT_BANDS);
  });

  it('accepts a plain number[] as well as a Uint8Array', () => {
    const arr = Array.from(bins(128));
    const result = reduceBands(arr, SAMPLE_RATE, FFT_SIZE);
    expect(result.bass).toBeCloseTo(128 / 255, 5);
  });

  it('places the sub-bass band below the bass band by frequency', () => {
    const sub = reduceBands(bins(255, [20, 60]), SAMPLE_RATE, FFT_SIZE);
    expect(sub.subBass).toBeGreaterThan(0);
    expect(sub.bass).toBe(0);
  });
});

describe('applyEnvelope', () => {
  it('rises fast on attack and falls slow on release', () => {
    const dt = 1 / 60;
    // Step from silence to a loud bass; one attack frame.
    const afterAttack = applyEnvelope(
      SILENT_BANDS,
      { subBass: 0, bass: 1, mid: 0, high: 0, rms: 1 },
      DEFAULT_ATTACK_S,
      DEFAULT_RELEASE_S,
      dt,
    );
    // Now release back toward silence; one release frame from the attacked value.
    const afterRelease = applyEnvelope(
      afterAttack,
      SILENT_BANDS,
      DEFAULT_ATTACK_S,
      DEFAULT_RELEASE_S,
      dt,
    );
    const attackRise = afterAttack.bass; // how far it climbed in one attack frame
    const releaseFall = afterAttack.bass - afterRelease.bass; // how far it fell
    // The attack coefficient is larger than the release coefficient, so the
    // single-frame rise exceeds the single-frame fall.
    expect(attackRise).toBeGreaterThan(releaseFall);
  });

  it('converges to a constant input over many frames', () => {
    const dt = 1 / 60;
    let bandsState = SILENT_BANDS;
    const target = { subBass: 0.5, bass: 0.8, mid: 0.3, high: 0.6, rms: 0.7 };
    for (let i = 0; i < 600; i += 1) {
      bandsState = applyEnvelope(
        bandsState,
        target,
        DEFAULT_ATTACK_S,
        DEFAULT_RELEASE_S,
        dt,
      );
    }
    expect(bandsState.bass).toBeCloseTo(0.8, 3);
    expect(bandsState.rms).toBeCloseTo(0.7, 3);
  });

  it('makes no change when dt <= 0', () => {
    const result = applyEnvelope(
      SILENT_BANDS,
      { subBass: 1, bass: 1, mid: 1, high: 1, rms: 1 },
      DEFAULT_ATTACK_S,
      DEFAULT_RELEASE_S,
      0,
    );
    expect(result).toEqual(SILENT_BANDS);
  });

  it('snaps instantly when tau is 0', () => {
    const result = applyEnvelope(
      SILENT_BANDS,
      { subBass: 0.4, bass: 0.9, mid: 0.2, high: 0.5, rms: 0.6 },
      0,
      0,
      1 / 60,
    );
    expect(result.bass).toBeCloseTo(0.9, 6);
  });

  it('keeps all bands within [0, 1]', () => {
    const result = applyEnvelope(
      { subBass: 0.9, bass: 0.9, mid: 0.9, high: 0.9, rms: 0.9 },
      { subBass: 1, bass: 1, mid: 1, high: 1, rms: 1 },
      DEFAULT_ATTACK_S,
      DEFAULT_RELEASE_S,
      1 / 60,
    );
    for (const v of Object.values(result)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
