import { describe, expect, it } from 'vitest';

import { HUD_IDLE_MS, shouldDimHud } from './auto-dim';

describe('shouldDimHud', () => {
  const base = {
    idleMs: HUD_IDLE_MS + 1,
    focusWithin: false,
    armed: true,
    reducedMotion: false,
  };

  it('dims once idle past the threshold when armed and unfocused', () => {
    expect(shouldDimHud(base)).toBe(true);
  });

  it('does not dim before the idle threshold', () => {
    expect(shouldDimHud({ ...base, idleMs: HUD_IDLE_MS - 1 })).toBe(false);
  });

  it('dims exactly at the threshold (inclusive)', () => {
    expect(shouldDimHud({ ...base, idleMs: HUD_IDLE_MS })).toBe(true);
  });

  it('NEVER dims when keyboard focus is inside the HUD (the a11y rule)', () => {
    expect(shouldDimHud({ ...base, focusWithin: true })).toBe(false);
  });

  it('never dims when not armed (the gate must invite)', () => {
    expect(shouldDimHud({ ...base, armed: false })).toBe(false);
  });

  it('never auto-dims under reduced-motion (no self-moving chrome)', () => {
    expect(shouldDimHud({ ...base, reducedMotion: true })).toBe(false);
  });

  it('respects a custom idle threshold', () => {
    expect(shouldDimHud({ ...base, idleMs: 600, idleThresholdMs: 500 })).toBe(true);
    expect(shouldDimHud({ ...base, idleMs: 400, idleThresholdMs: 500 })).toBe(false);
  });

  it('focus wins over an elapsed idle window', () => {
    expect(
      shouldDimHud({ ...base, idleMs: 100_000, focusWithin: true }),
    ).toBe(false);
  });
});
