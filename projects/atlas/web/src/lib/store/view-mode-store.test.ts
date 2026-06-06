import { describe, expect, it } from 'vitest';

import { resolveEffectiveView } from '@/lib/store/view-mode-store';

/**
 * The view-mode resolution is the load-bearing logic of the no-WebGL degradation
 * arm (Task 6.1): capability ALWAYS wins over preference, and the table is a
 * first-class user choice when the map is available.
 */
describe('resolveEffectiveView', () => {
  it('shows the map when WebGL is available and preference follows capability', () => {
    expect(resolveEffectiveView('auto', true)).toBe('map');
  });

  it('shows the map when WebGL is available and the user explicitly chose map', () => {
    expect(resolveEffectiveView('map', true)).toBe('map');
  });

  it('shows the table when the user explicitly chose the table view', () => {
    expect(resolveEffectiveView('table', true)).toBe('table');
  });

  it('forces the table when WebGL is unavailable, regardless of auto', () => {
    expect(resolveEffectiveView('auto', false)).toBe('table');
  });

  it('forces the table when WebGL is unavailable even if the user asked for the map', () => {
    // Capability wins — we cannot render a WebGL map without WebGL.
    expect(resolveEffectiveView('map', false)).toBe('table');
  });

  it('keeps the table when WebGL is unavailable and the preference is table', () => {
    expect(resolveEffectiveView('table', false)).toBe('table');
  });
});
