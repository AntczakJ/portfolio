import type { IncidentSeverity, MonitorStatus } from '../lib/schemas/events';

/**
 * The incident state machine — a PURE reducer (Task 5.1, ADR-004).
 *
 * `reduce(state, input) -> { state, effects }`. No IO. The engine
 * (`IncidentEngineService`) calls this, persists incident rows from the
 * returned `effects`, and emits the `incident.*` domain events. Keeping the
 * machine pure is what makes every ADR-004 invariant exhaustively unit-testable
 * against a status sequence with a KNOWN expected incident count — the
 * "heavy domain logic" senior signal and the regression guard for the wow
 * moment.
 *
 * The model (ADR-004), restated precisely:
 *
 *  - Two counters per monitor: `consecutiveBad` (a `down` OR `degraded` check
 *    increments it; an `up` resets it to 0) and `consecutiveGood` (an `up`
 *    increments it; a non-`up` resets it to 0). Exactly one of the two is
 *    non-zero after any input (a check is either `up` or not).
 *  - OPEN: when `consecutiveBad` reaches the monitor's failure threshold N
 *    (default 3) AND no incident is open, open EXACTLY ONE incident. Its
 *    severity is the WORST status across the run of bad checks (`down`
 *    dominates `degraded`).
 *  - SINGLE-OPEN INVARIANT: while an incident is open, further bad checks NEVER
 *    open a second incident. They may only ESCALATE its severity
 *    (`degraded -> down`); they never de-escalate (`down -> degraded`).
 *  - CLOSE: when `consecutiveGood` reaches the recovery threshold M (default 2)
 *    AND an incident is open, close it.
 *  - FLAP SUPPRESSION: the N/M debounce IS the flap suppression. A single bad
 *    check (N >= 2) never opens; a single good check (M >= 2) never closes. A
 *    monitor oscillating up/bad/up/bad never accumulates N consecutive bad, so
 *    it never opens.
 *
 * `down` vs `degraded`: a check that is `degraded` is "bad" for the debounce
 * (slow == not healthy) but opens a `degraded`-severity incident; a `down`
 * check while a `degraded` incident is open escalates it to `down`.
 */

/** The reducer state for a single monitor (the engine rehydrates this per check). */
export interface IncidentReducerState {
  /** Consecutive non-`up` checks (down or degraded). Reset by an `up`. */
  consecutiveBad: number;
  /** Consecutive `up` checks. Reset by any non-`up`. */
  consecutiveGood: number;
  /**
   * The worst severity observed across the CURRENT run of consecutive bad
   * checks (reset to `null` by an `up`). Tracked so an incident opens with the
   * worst severity across the N failing checks (ADR-004: "its severity is the
   * worst status across those N checks"), not just the severity of the Nth one.
   */
  worstBadSeverity: IncidentSeverity | null;
  /**
   * The currently-open incident's severity, or `null` if no incident is open.
   * The engine persists the row; the reducer tracks only the severity it needs
   * to decide escalation. The DB's partial-unique index is the ultimate guard
   * (ADR-005), but the reducer enforces single-open too so the two never fight.
   */
  openSeverity: IncidentSeverity | null;
}

/** The input the reducer reacts to: one derived per-check status. */
export interface IncidentReducerInput {
  status: MonitorStatus;
  /** Failure threshold N for this monitor (default 3). */
  failureThreshold: number;
  /** Recovery threshold M for this monitor (default 2). */
  recoveryThreshold: number;
}

/**
 * An effect the engine must carry out (persist a row + emit an event). The
 * reducer never does IO; it only describes WHAT happened.
 */
export type IncidentEffect =
  | {
      type: 'incident.open';
      /** The opened incident's severity (worst across the failure run). */
      severity: IncidentSeverity;
    }
  | {
      type: 'incident.escalate';
      /** The new (worse) severity of the already-open incident. */
      severity: IncidentSeverity;
    }
  | {
      type: 'incident.close';
    };

export interface IncidentReducerResult {
  state: IncidentReducerState;
  effects: IncidentEffect[];
}

/** A fresh monitor with no history: no failures, no open incident. */
export function initialIncidentState(): IncidentReducerState {
  return {
    consecutiveBad: 0,
    consecutiveGood: 0,
    worstBadSeverity: null,
    openSeverity: null,
  };
}

/** `true` if `a` is a strictly worse severity than `b` (`down` > `degraded`). */
function isWorse(a: IncidentSeverity, b: IncidentSeverity): boolean {
  return a === 'down' && b === 'degraded';
}

/** The worse of two severities (`down` dominates `degraded`). */
function worse(a: IncidentSeverity, b: IncidentSeverity): IncidentSeverity {
  return a === 'down' || b === 'down' ? 'down' : 'degraded';
}

/** Map a non-`up` check status to an incident severity. */
function severityOf(status: 'degraded' | 'down'): IncidentSeverity {
  return status;
}

/**
 * Apply one check result to the state. Returns the next state and the effects
 * the engine must persist + emit, in order.
 *
 * Pure: same `(state, input)` always yields the same result; no Date.now(), no
 * DB, no randomness. The engine stamps timestamps and ids when it persists.
 */
export function reduceIncident(
  state: IncidentReducerState,
  input: IncidentReducerInput,
): IncidentReducerResult {
  const { status, failureThreshold, recoveryThreshold } = input;
  const effects: IncidentEffect[] = [];

  if (status === 'up') {
    // A good check: bump the recovery counter, reset the failure run + its
    // worst-severity tracker.
    const consecutiveGood = state.consecutiveGood + 1;
    let openSeverity = state.openSeverity;

    // CLOSE when we hit M consecutive good AND an incident is open.
    if (openSeverity !== null && consecutiveGood >= recoveryThreshold) {
      effects.push({ type: 'incident.close' });
      openSeverity = null;
    }

    return {
      state: { consecutiveBad: 0, consecutiveGood, worstBadSeverity: null, openSeverity },
      effects,
    };
  }

  // A bad check (down or degraded): bump the failure counter, reset recovery,
  // and track the worst severity across this failing run.
  const consecutiveBad = state.consecutiveBad + 1;
  const checkSeverity = severityOf(status);
  const worstBadSeverity =
    state.worstBadSeverity === null
      ? checkSeverity
      : worse(state.worstBadSeverity, checkSeverity);
  let openSeverity = state.openSeverity;

  if (openSeverity === null) {
    // No incident open yet. OPEN when we reach N consecutive bad. The opened
    // severity is the WORST across the N failing checks (ADR-004) — e.g. a run
    // degraded, degraded, down opens a `down` incident, not a `degraded` one.
    if (consecutiveBad >= failureThreshold) {
      openSeverity = worstBadSeverity;
      effects.push({ type: 'incident.open', severity: worstBadSeverity });
    }
  } else if (isWorse(checkSeverity, openSeverity)) {
    // An incident is already open: NEVER open a second one (the single-open
    // invariant). A worse severity ESCALATES the open incident; an equal or
    // lesser severity is a no-op (we never de-escalate `down -> degraded`).
    openSeverity = checkSeverity;
    effects.push({ type: 'incident.escalate', severity: checkSeverity });
  }

  return {
    state: { consecutiveBad, consecutiveGood: 0, worstBadSeverity, openSeverity },
    effects,
  };
}
