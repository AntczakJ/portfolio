import { describe, expect, it } from 'vitest';

import { tierConfigSchema, type TierConfig } from '@/lib/schemas';

import {
  defaultMotionMode,
  isAudioReactive,
  isPointerWakeActive,
  resolveRenderRoute,
  shouldRunLoop,
} from './routing';

function makeConfig(over: Partial<TierConfig> = {}): TierConfig {
  return tierConfigSchema.parse({
    tier: 'high',
    route: 'live',
    simResolution: 512,
    particleCount: 512 * 512,
    dprClamp: [1, 2],
    postQuality: 'full',
    audioReactive: true,
    pointerWake: true,
    reason: 'test',
    ...over,
  });
}

describe('resolveRenderRoute', () => {
  it('keeps a live route as live under full motion', () => {
    expect(resolveRenderRoute(makeConfig(), 'full')).toBe('live');
  });

  it('forces poster when the user picks Still', () => {
    expect(resolveRenderRoute(makeConfig(), 'still')).toBe('poster');
  });

  it('forces calm when the user picks calm', () => {
    expect(resolveRenderRoute(makeConfig(), 'calm')).toBe('calm');
  });

  it('keeps poster as poster regardless of intent (the float gate cannot be overridden)', () => {
    const poster = makeConfig({ route: 'poster', audioReactive: false, pointerWake: false });
    expect(resolveRenderRoute(poster, 'full')).toBe('poster');
    expect(resolveRenderRoute(poster, 'calm')).toBe('poster');
  });

  it('lets a user opt a reduced-motion calm route back into live with explicit full', () => {
    const calm = makeConfig({ route: 'calm', audioReactive: false, pointerWake: false });
    expect(resolveRenderRoute(calm, 'full')).toBe('live');
  });
});

describe('defaultMotionMode', () => {
  it('maps each route to its default mode', () => {
    expect(defaultMotionMode(makeConfig({ route: 'live' }))).toBe('full');
    expect(defaultMotionMode(makeConfig({ route: 'calm' }))).toBe('calm');
    expect(
      defaultMotionMode(makeConfig({ route: 'poster', audioReactive: false, pointerWake: false })),
    ).toBe('still');
  });
});

describe('isAudioReactive / isPointerWakeActive', () => {
  it('reacts only on a live route under full motion', () => {
    expect(isAudioReactive(makeConfig(), 'full')).toBe(true);
    expect(isAudioReactive(makeConfig(), 'calm')).toBe(false);
    expect(isAudioReactive(makeConfig(), 'still')).toBe(false);
  });

  it('mutes reactivity when the config itself disabled it (reduced-motion)', () => {
    const calm = makeConfig({ route: 'calm', audioReactive: false });
    expect(isAudioReactive(calm, 'full')).toBe(true); // user opted back to live
    expect(isAudioReactive(calm, 'calm')).toBe(false);
  });

  it('wakes the pointer only on a live route under full motion', () => {
    expect(isPointerWakeActive(makeConfig(), 'full')).toBe(true);
    expect(isPointerWakeActive(makeConfig(), 'calm')).toBe(false);
  });
});

describe('shouldRunLoop', () => {
  it('runs the loop only when armed and visible on a live/calm route', () => {
    expect(shouldRunLoop('live', true, false)).toBe(true);
    expect(shouldRunLoop('calm', true, false)).toBe(true);
    expect(shouldRunLoop('poster', true, false)).toBe(false);
  });

  it('pauses when the tab is hidden', () => {
    expect(shouldRunLoop('live', true, true)).toBe(false);
  });

  it('pauses when not armed (pre-gesture)', () => {
    expect(shouldRunLoop('live', false, false)).toBe(false);
  });
});
