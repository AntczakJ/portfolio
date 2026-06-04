import { describe, expect, it } from 'vitest';

import type { MonitorStatus } from '../lib/schemas/events';
import {
  initialIncidentState,
  reduceIncident,
  type IncidentEffect,
  type IncidentReducerState,
} from './incident-reducer';

/**
 * Incident state-machine invariants (ADR-004). These tests ENCODE the ADR rules
 * and are the centerpiece of Phase 5: the wow moment (an incident opening live)
 * is only credible if the machine that opens it is provably correct.
 *
 * The success criteria mapped to tests:
 *   - N consecutive failures opens EXACTLY ONE incident (not N).
 *   - An intervening success resets the failure counter (no premature open).
 *   - M consecutive successes closes it.
 *   - Flapping (up/bad/up/bad) never opens an incident.
 *   - degraded vs down classification + escalation on the open incident.
 *   - The single-open invariant: further bad checks never open a second.
 */

const N = 3; // default failure threshold
const M = 2; // default recovery threshold

/**
 * Drive a status sequence through the reducer from a fresh state, collecting
 * every effect emitted in order. Returns the final state + the flat effect log.
 */
function run(
  statuses: MonitorStatus[],
  failureThreshold = N,
  recoveryThreshold = M,
): { state: IncidentReducerState; effects: IncidentEffect[] } {
  let state = initialIncidentState();
  const effects: IncidentEffect[] = [];
  for (const status of statuses) {
    const result = reduceIncident(state, { status, failureThreshold, recoveryThreshold });
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

/** Count effects of a given type in the log. */
function count(effects: IncidentEffect[], type: IncidentEffect['type']): number {
  return effects.filter((e) => e.type === type).length;
}

describe('reduceIncident — opening on N consecutive failures', () => {
  it('a single down check does NOT open an incident (debounce floor)', () => {
    const { state, effects } = run(['down']);
    expect(effects).toEqual([]);
    expect(state.openSeverity).toBeNull();
    expect(state.consecutiveBad).toBe(1);
  });

  it('N-1 down checks do NOT open; the Nth does', () => {
    const before = run(['down', 'down']);
    expect(before.effects).toEqual([]);

    const at = run(['down', 'down', 'down']);
    expect(count(at.effects, 'incident.open')).toBe(1);
    expect(at.effects.find((e) => e.type === 'incident.open')).toMatchObject({
      type: 'incident.open',
      severity: 'down',
    });
    expect(at.state.openSeverity).toBe('down');
  });

  it('N consecutive failures opens EXACTLY ONE incident, not N (the core invariant)', () => {
    // Ten consecutive down checks — only one open effect must be emitted.
    const { effects, state } = run(Array.from({ length: 10 }, () => 'down' as const));
    expect(count(effects, 'incident.open')).toBe(1);
    expect(count(effects, 'incident.close')).toBe(0);
    expect(state.openSeverity).toBe('down');
  });

  it('honours a custom failure threshold (N=5)', () => {
    const four = run(['down', 'down', 'down', 'down'], 5);
    expect(four.effects).toEqual([]);
    const five = run(['down', 'down', 'down', 'down', 'down'], 5);
    expect(count(five.effects, 'incident.open')).toBe(1);
  });

  it('N=1 opens on the very first bad check', () => {
    const { effects } = run(['down'], 1);
    expect(count(effects, 'incident.open')).toBe(1);
  });
});

describe('reduceIncident — the failure counter resets on success', () => {
  it('an intervening success resets consecutiveBad so the count restarts', () => {
    // down, down, up, down, down — never 3 consecutive bad, so never opens.
    const { effects, state } = run(['down', 'down', 'up', 'down', 'down']);
    expect(count(effects, 'incident.open')).toBe(0);
    expect(state.openSeverity).toBeNull();
    expect(state.consecutiveBad).toBe(2);
  });

  it('after a reset, a fresh run of N opens once', () => {
    // down, down, up resets; then down, down, down opens.
    const { effects } = run(['down', 'down', 'up', 'down', 'down', 'down']);
    expect(count(effects, 'incident.open')).toBe(1);
  });
});

describe('reduceIncident — closing on M consecutive successes', () => {
  it('M consecutive successes after an open incident closes it', () => {
    const { effects, state } = run(['down', 'down', 'down', 'up', 'up']);
    expect(count(effects, 'incident.open')).toBe(1);
    expect(count(effects, 'incident.close')).toBe(1);
    // The close effect comes AFTER the open in the log.
    expect(effects.map((e) => e.type)).toEqual(['incident.open', 'incident.close']);
    expect(state.openSeverity).toBeNull();
  });

  it('a single success does NOT close (M=2 debounce)', () => {
    const { effects, state } = run(['down', 'down', 'down', 'up']);
    expect(count(effects, 'incident.close')).toBe(0);
    expect(state.openSeverity).toBe('down'); // still open
    expect(state.consecutiveGood).toBe(1);
  });

  it('a success then a relapse resets recovery so the incident stays open', () => {
    // open, then up (good=1), then down (resets good), then up,up would be needed again.
    const { effects, state } = run(['down', 'down', 'down', 'up', 'down', 'up']);
    expect(count(effects, 'incident.close')).toBe(0);
    expect(state.openSeverity).toBe('down');
    expect(state.consecutiveGood).toBe(1);
  });

  it('honours a custom recovery threshold (M=3)', () => {
    const two = run(['down', 'down', 'down', 'up', 'up'], N, 3);
    expect(count(two.effects, 'incident.close')).toBe(0);
    const three = run(['down', 'down', 'down', 'up', 'up', 'up'], N, 3);
    expect(count(three.effects, 'incident.close')).toBe(1);
  });

  it('a full open -> close -> reopen arc emits two opens and one close in order', () => {
    const { effects } = run([
      'down', 'down', 'down', // open #1
      'up', 'up', // close #1
      'down', 'down', 'down', // open #2
    ]);
    expect(count(effects, 'incident.open')).toBe(2);
    expect(count(effects, 'incident.close')).toBe(1);
    expect(effects.map((e) => e.type)).toEqual([
      'incident.open',
      'incident.close',
      'incident.open',
    ]);
  });
});

describe('reduceIncident — flap suppression (the N/M debounce IS the suppression)', () => {
  it('perfect oscillation up/down/up/down never opens an incident', () => {
    const seq: MonitorStatus[] = [];
    for (let i = 0; i < 20; i += 1) seq.push(i % 2 === 0 ? 'down' : 'up');
    const { effects, state } = run(seq);
    expect(count(effects, 'incident.open')).toBe(0);
    expect(state.openSeverity).toBeNull();
  });

  it('down/down/up/down/down/up never reaches N consecutive bad', () => {
    const { effects } = run(['down', 'down', 'up', 'down', 'down', 'up', 'down', 'down']);
    expect(count(effects, 'incident.open')).toBe(0);
  });

  it('genuine sustained failure at the boundary opens once and stays open through flaps under M', () => {
    // 3 down opens; then up (good=1) / down resets repeatedly — never M clean,
    // so the single incident never closes and never duplicates.
    const { effects, state } = run([
      'down', 'down', 'down', // open
      'up', 'down', 'up', 'down', 'up', 'down', // flapping below M
    ]);
    expect(count(effects, 'incident.open')).toBe(1);
    expect(count(effects, 'incident.close')).toBe(0);
    expect(state.openSeverity).toBe('down');
  });
});

describe('reduceIncident — degraded vs down classification + escalation', () => {
  it('degraded checks count toward the failure debounce and open a degraded incident', () => {
    const { effects, state } = run(['degraded', 'degraded', 'degraded']);
    expect(effects).toEqual([{ type: 'incident.open', severity: 'degraded' }]);
    expect(state.openSeverity).toBe('degraded');
  });

  it('a mixed run opens with the WORST severity across the N checks (down dominates)', () => {
    // degraded, degraded, down => the run's worst is `down` => open `down`.
    const { effects } = run(['degraded', 'degraded', 'down']);
    expect(effects).toEqual([{ type: 'incident.open', severity: 'down' }]);
  });

  it('a degraded incident ESCALATES to down on a later down check (no second incident)', () => {
    const { effects, state } = run([
      'degraded', 'degraded', 'degraded', // open degraded
      'down', // escalate
    ]);
    expect(count(effects, 'incident.open')).toBe(1);
    expect(count(effects, 'incident.escalate')).toBe(1);
    expect(effects).toEqual([
      { type: 'incident.open', severity: 'degraded' },
      { type: 'incident.escalate', severity: 'down' },
    ]);
    expect(state.openSeverity).toBe('down');
  });

  it('escalation fires only ONCE — a second down after escalating is a no-op', () => {
    const { effects } = run([
      'degraded', 'degraded', 'degraded', // open degraded
      'down', 'down', 'down', // escalate once, then no-ops
    ]);
    expect(count(effects, 'incident.escalate')).toBe(1);
  });

  it('NEVER de-escalates: a down incident does not drop to degraded on a degraded check', () => {
    const { effects, state } = run([
      'down', 'down', 'down', // open down
      'degraded', 'degraded', // no de-escalation
    ]);
    expect(count(effects, 'incident.escalate')).toBe(0);
    expect(state.openSeverity).toBe('down');
  });
});

describe('reduceIncident — the single-open invariant under any sequence', () => {
  it('across a long noisy sequence, opens never exceed closes + 1 and never run negative', () => {
    // A pseudo-random but deterministic sequence.
    const pattern: MonitorStatus[] = [
      'down', 'down', 'down', 'down', 'up', 'down', 'up', 'up', 'down', 'down',
      'down', 'degraded', 'down', 'up', 'up', 'up', 'down', 'down', 'down', 'up',
      'up', 'degraded', 'degraded', 'degraded', 'down', 'up', 'up',
    ];
    let state = initialIncidentState();
    let openCount = 0;
    for (const status of pattern) {
      const { state: next, effects } = reduceIncident(state, {
        status,
        failureThreshold: N,
        recoveryThreshold: M,
      });
      for (const e of effects) {
        if (e.type === 'incident.open') openCount += 1;
        if (e.type === 'incident.close') openCount -= 1;
        // At no point may two incidents be open simultaneously.
        expect(openCount).toBeLessThanOrEqual(1);
        expect(openCount).toBeGreaterThanOrEqual(0);
      }
      // The reducer's own openSeverity tracks the same single-open truth.
      expect(openCount === 1 ? next.openSeverity !== null : next.openSeverity === null).toBe(true);
      state = next;
    }
  });

  it('the reducer is pure — the same (state, input) yields an identical result', () => {
    const state = initialIncidentState();
    const input = { status: 'down' as const, failureThreshold: N, recoveryThreshold: M };
    const a = reduceIncident(state, input);
    const b = reduceIncident(state, input);
    expect(a).toEqual(b);
    // and the input state is not mutated.
    expect(state).toEqual(initialIncidentState());
  });
});
