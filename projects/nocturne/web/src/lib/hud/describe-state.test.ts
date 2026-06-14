import { describe, expect, it } from 'vitest';

import { describeFieldState, sourceLabel } from './describe-state';

describe('sourceLabel', () => {
  it('labels each audio source', () => {
    expect(sourceLabel('builtin')).toMatch(/synthes/i);
    expect(sourceLabel('mic')).toMatch(/microphone/i);
    expect(sourceLabel('upload')).toMatch(/uploaded/i);
  });
});

describe('describeFieldState', () => {
  const base = {
    presetName: 'Aurora',
    source: 'builtin' as const,
    route: 'live' as const,
    armed: true,
    muted: false,
  };

  it('describes a live reacting field with the preset + source', () => {
    const text = describeFieldState(base);
    expect(text).toContain('Aurora');
    expect(text).toMatch(/reacting to/i);
    expect(text).toMatch(/synthes/i);
  });

  it('omits reactivity when muted', () => {
    const text = describeFieldState({ ...base, muted: true });
    expect(text).toMatch(/muted/i);
    expect(text).not.toMatch(/reacting to/i);
  });

  it('describes the calm reduced-motion drift without reactivity', () => {
    const text = describeFieldState({ ...base, route: 'calm' });
    expect(text).toMatch(/drifting calmly/i);
    expect(text).toMatch(/reduced motion/i);
  });

  it('describes the pre-arm invitation when not armed', () => {
    const text = describeFieldState({ ...base, armed: false });
    expect(text).toMatch(/paused|begin/i);
    expect(text).toContain('Aurora');
  });

  it('describes the poster still on the poster route', () => {
    const text = describeFieldState({ ...base, route: 'poster' });
    expect(text).toMatch(/static composed still/i);
    expect(text).toContain('Aurora');
  });

  it('reflects the mic source in the live description', () => {
    const text = describeFieldState({ ...base, source: 'mic' });
    expect(text).toMatch(/microphone/i);
  });
});
