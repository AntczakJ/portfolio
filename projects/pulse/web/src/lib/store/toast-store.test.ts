import { beforeEach, describe, expect, it } from 'vitest';

import { useToastStore } from './toast-store';

/**
 * The toast coherence rules (C-2): the stack must read as ONE event, not a pile
 * of contradictory notifications. These cover the cap, dedupe, per-subject
 * supersede, and explicit dismiss behaviours the store guarantees.
 */

function toasts() {
  return useToastStore.getState().toasts;
}

describe('toast-store', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  it('caps the visible stack at 3, evicting the oldest', () => {
    const push = useToastStore.getState().pushToast;
    for (let i = 0; i < 5; i += 1) {
      push({ title: `toast ${String(i)}` });
    }
    expect(toasts()).toHaveLength(3);
    // The three most recent survive (oldest evicted).
    expect(toasts().map((t) => t.title)).toEqual([
      'toast 2',
      'toast 3',
      'toast 4',
    ]);
  });

  it('dedupes by dedupeKey (replaces, does not stack)', () => {
    const push = useToastStore.getState().pushToast;
    push({ title: 'first', dedupeKey: 'k' });
    push({ title: 'second', dedupeKey: 'k' });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.title).toBe('second');
  });

  it('supersedes a prior toast for the same subject (down evicts recovered)', () => {
    const push = useToastStore.getState().pushToast;
    // A monitor first recovers, then a NEW incident opens for it: the new
    // "down" toast must evict the stale "recovered" so they never coexist.
    push({
      tone: 'up',
      title: 'API is back up',
      supersedeKey: 'monitor-API',
    });
    push({
      tone: 'down',
      title: 'API is down',
      supersedeKey: 'monitor-API',
    });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.title).toBe('API is down');
    expect(toasts()[0]?.tone).toBe('down');
  });

  it('keeps supersede keys for DIFFERENT subjects independent', () => {
    const push = useToastStore.getState().pushToast;
    push({ title: 'API is down', supersedeKey: 'monitor-API' });
    push({ title: 'Web is down', supersedeKey: 'monitor-Web' });
    expect(toasts()).toHaveLength(2);
  });

  it('dismisses listed ids when a toast is pushed (armed -> opened)', () => {
    const push = useToastStore.getState().pushToast;
    // The demo "armed" info toast must vanish the instant the incident opens.
    push({ title: 'Demo armed', dedupeKey: 'demo-armed', tone: 'info' });
    expect(toasts().some((t) => t.id === 'demo-armed')).toBe(true);
    push({
      title: 'Checkout is down',
      supersedeKey: 'monitor-Checkout',
      dismissKeys: ['demo-armed'],
    });
    expect(toasts().some((t) => t.id === 'demo-armed')).toBe(false);
    expect(toasts().some((t) => t.title === 'Checkout is down')).toBe(true);
  });
});
