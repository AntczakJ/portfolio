import { afterEach, describe, expect, it } from 'vitest';

import { isWebglAvailable, setWebglAvailableForTest } from '@/lib/map/webgl-support';

/**
 * The WebGL probe gates the no-WebGL degradation arm. jsdom does not implement a
 * WebGL context, so the real probe returns false there — which is exactly the
 * "no WebGL" path. We assert both the real probe behaviour and the cache/test
 * seam used to simulate the two worlds.
 */
describe('isWebglAvailable', () => {
  afterEach(() => {
    setWebglAvailableForTest(null);
  });

  it('returns false under jsdom (no WebGL context) — the no-WebGL path', () => {
    setWebglAvailableForTest(null);
    expect(isWebglAvailable()).toBe(false);
  });

  it('honours the forced value (test seam) for the WebGL-present path', () => {
    setWebglAvailableForTest(true);
    expect(isWebglAvailable()).toBe(true);
  });

  it('caches the result so repeated calls do not re-probe', () => {
    setWebglAvailableForTest(false);
    expect(isWebglAvailable()).toBe(false);
    expect(isWebglAvailable()).toBe(false);
  });
});
