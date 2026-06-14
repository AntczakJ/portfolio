import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PRESET_ID } from '@/data/presets';

import { useExperienceStore } from './experience-store';

/** Reset the store to its initial state between tests (it is a module singleton). */
function reset(): void {
  useExperienceStore.setState({
    presetId: DEFAULT_PRESET_ID,
    transitioningToId: null,
    audioSource: 'builtin',
    muted: false,
    armState: 'idle',
    motionMode: 'full',
    pointerInteraction: true,
    hudDimmed: false,
  });
}

const get = () => useExperienceStore.getState();

describe('experience store — preset transitions', () => {
  beforeEach(reset);

  it('starts on the default preset, not transitioning', () => {
    expect(get().presetId).toBe(DEFAULT_PRESET_ID);
    expect(get().transitioningToId).toBeNull();
  });

  it('selectPreset begins a cross-fade to a known preset', () => {
    get().selectPreset('molten-swirl');
    expect(get().transitioningToId).toBe('molten-swirl');
    expect(get().presetId).toBe(DEFAULT_PRESET_ID); // not yet settled
  });

  it('completePresetTransition settles the active preset', () => {
    get().selectPreset('molten-swirl');
    get().completePresetTransition();
    expect(get().presetId).toBe('molten-swirl');
    expect(get().transitioningToId).toBeNull();
  });

  it('ignores selecting an unknown preset', () => {
    get().selectPreset('does-not-exist');
    expect(get().transitioningToId).toBeNull();
  });

  it('ignores re-selecting the already-active preset', () => {
    get().selectPreset(DEFAULT_PRESET_ID);
    expect(get().transitioningToId).toBeNull();
  });

  it('completePresetTransition is a no-op when not transitioning', () => {
    get().completePresetTransition();
    expect(get().presetId).toBe(DEFAULT_PRESET_ID);
  });
});

describe('experience store — audio + motion + arm', () => {
  beforeEach(reset);

  it('switches the audio source', () => {
    get().setAudioSource('mic');
    expect(get().audioSource).toBe('mic');
  });

  it('toggles mute', () => {
    get().toggleMute();
    expect(get().muted).toBe(true);
    get().toggleMute();
    expect(get().muted).toBe(false);
  });

  it('arms once and is idempotent', () => {
    expect(get().armState).toBe('idle');
    get().arm();
    expect(get().armState).toBe('armed');
    get().arm();
    expect(get().armState).toBe('armed');
  });

  it('sets the motion mode (Still toggle)', () => {
    get().setMotionMode('still');
    expect(get().motionMode).toBe('still');
  });

  it('toggles pointer interaction', () => {
    get().togglePointerInteraction();
    expect(get().pointerInteraction).toBe(false);
  });

  it('sets the HUD dimmed flag (opacity-only auto-dim)', () => {
    get().setHudDimmed(true);
    expect(get().hudDimmed).toBe(true);
  });
});
