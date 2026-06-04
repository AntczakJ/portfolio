'use client';

import { create } from 'zustand';

import type { DisplayStatus } from '@/lib/status/status-tokens';
import type { MonitorResponse } from 'pulse-server';
import type { SseEvent } from 'pulse-server/events';

/**
 * The live board store (Task 3.3).
 *
 * Holds, keyed by monitorId, the live-derived view of each monitor: its
 * current display status, the latest check result (response time, status
 * code, checked-at), and a ROLLING BUFFER of recent response-time points
 * that feeds the hand-rolled SVG sparkline (ADR-001: the sparkline is NOT
 * a uPlot chart and is NOT animated through Motion — it is drawn directly
 * from this buffer).
 *
 * The reducer (`applyEvent`) is PURE over the live-state slice and is the
 * single place SSE events mutate the board. Both the EventSource client
 * (`use-live-board.ts`) and the unit tests drive it, so the "a check.result
 * updates the card + sparkline; a status.change flips status; a malformed /
 * out-of-scope event is ignored" behaviour is tested without a browser.
 *
 * The REST monitor list (name, url, interval, current_status, last_checked)
 * is owned by TanStack Query and reconciled into this store on every fetch
 * (`hydrateFromRest`) — on SSE open/reconnect we refetch and reconcile, the
 * ADR-003 "Pub/Sub is fire-and-forget; reconcile via REST on reconnect"
 * consistency model. Live events then run forward from that snapshot.
 */

/** How many response-time points the sparkline keeps per monitor. */
export const SPARKLINE_BUFFER_SIZE = 40;

export interface SparklinePoint {
  /** Response time in ms; null when the check produced no timing (e.g. a
   * transport error / SSRF block — drawn as a gap, see the sparkline). */
  readonly value: number | null;
  /** The status that produced this point, for per-point coloring. */
  readonly status: DisplayStatus;
  /** Epoch ms of the check, for ordering / tooltips. */
  readonly at: number;
}

export interface LiveMonitorState {
  readonly status: DisplayStatus;
  /** Latest response time in ms, or null if unknown / errored. */
  readonly lastResponseTimeMs: number | null;
  /** Latest HTTP status code, or null. */
  readonly lastStatusCode: number | null;
  /** Epoch ms of the last check, or null if never checked live. */
  readonly lastCheckedAt: number | null;
  /** Rolling response-time buffer for the sparkline (oldest -> newest). */
  readonly sparkline: readonly SparklinePoint[];
  /** True while an incident is open for this monitor (drives the card ring). */
  readonly hasOpenIncident: boolean;
  /**
   * The severity of the monitor's open incident (`down` | `degraded`), or
   * `null` when no incident is open. This is the C-1 fan-out anchor: when an
   * `incident.open` lands, the card's DISPLAYED status is forced to this
   * severity the SAME tick the summary bar, the incident strip and the toast
   * react — so the dramatic beat lands as ONE coordinated transition instead
   * of the card lagging behind on a separate, later `status.change` event.
   * Cleared on `incident.close`; the next live `check.result` then takes over.
   */
  readonly incidentSeverity: 'down' | 'degraded' | null;
}

/**
 * A live incident slice — the minimal shape the board's incident surface and
 * the incidents view keep in sync from the SSE `incident.*` events (the REST
 * `GET /incidents` snapshot carries the richer {@link IncidentListItem}; this
 * is the live overlay that opens a row and stamps its resolution).
 */
export interface LiveIncident {
  readonly incidentId: string;
  readonly monitorId: string;
  readonly severity: 'degraded' | 'down';
  readonly startedAt: string;
  readonly resolvedAt: string | null;
  readonly status: 'open' | 'resolved';
  readonly cause: string | null;
  readonly durationMs: number | null;
}

export interface LiveBoardState {
  /** Live-derived per-monitor state, keyed by monitorId. */
  readonly monitors: Readonly<Record<string, LiveMonitorState>>;
  /**
   * A monotonically increasing token bumped whenever a fresh `check.result`
   * lands for a monitor — the card subscribes to its own token to fire the
   * Motion "fresh result" pulse without re-pulsing on unrelated updates.
   */
  readonly pulseToken: Readonly<Record<string, number>>;
  /** The last announcement string for the aria-live region (status flips). */
  readonly announcement: string | null;
  /**
   * Live incident overlay, keyed by incidentId. `incident.open` inserts an
   * open row; `incident.close` stamps its resolution. The incidents view
   * merges this over the REST snapshot so a row that opened live (or closed
   * live) reflects instantly without waiting for a refetch.
   */
  readonly incidents: Readonly<Record<string, LiveIncident>>;
  /**
   * A monotonic token bumped on any `incident.open` / `incident.close` so the
   * incidents view can trigger an `AnimatePresence` re-sort / a reconcile
   * refetch without subscribing to the whole incidents record.
   */
  readonly incidentToken: number;
}

export interface LiveBoardActions {
  /** Apply one validated SSE event. Pure over the state slice. */
  applyEvent: (event: SseEvent) => void;
  /** Reconcile the REST monitor snapshot into the store (open/reconnect). */
  hydrateFromRest: (monitors: readonly MonitorResponse[]) => void;
  /** Reset (e.g. on user change / sign-out). */
  reset: () => void;
}

export type LiveBoardStore = LiveBoardState & LiveBoardActions;

const EMPTY_MONITOR: LiveMonitorState = {
  status: 'unknown',
  lastResponseTimeMs: null,
  lastStatusCode: null,
  lastCheckedAt: null,
  sparkline: [],
  hasOpenIncident: false,
  incidentSeverity: null,
};

function pushSparkline(
  buffer: readonly SparklinePoint[],
  point: SparklinePoint,
): readonly SparklinePoint[] {
  const next = [...buffer, point];
  return next.length > SPARKLINE_BUFFER_SIZE
    ? next.slice(next.length - SPARKLINE_BUFFER_SIZE)
    : next;
}

/**
 * The pure reducer body, exported for unit testing. Returns the next state
 * slice given the current one and an event. An event for a monitor we have
 * never seen creates that monitor's slice (the REST list may not have
 * arrived yet, or a monitor was created mid-stream).
 *
 * `heartbeat` and any event type the board does not model leave state
 * unchanged (returned as-is) so the store does not churn on keep-alives.
 */
export function reduceLiveBoard(
  state: LiveBoardState,
  event: SseEvent,
): LiveBoardState {
  switch (event.type) {
    case 'check.result': {
      const { monitorId, status, responseTimeMs, statusCode, checkedAt } =
        event.payload;
      const prev = state.monitors[monitorId] ?? EMPTY_MONITOR;
      const at = Date.parse(checkedAt);
      const nextMonitor: LiveMonitorState = {
        ...prev,
        // While an incident is OPEN the card status is pinned to the incident
        // severity (C-1): the dramatic beat opened it down, and a single stray
        // probe must not un-flip the card before the incident actually closes.
        // The metric (response time / code / sparkline) still updates live.
        status: prev.incidentSeverity ?? status,
        lastResponseTimeMs: responseTimeMs,
        lastStatusCode: statusCode,
        lastCheckedAt: Number.isNaN(at) ? prev.lastCheckedAt : at,
        sparkline: pushSparkline(prev.sparkline, {
          value: responseTimeMs,
          status,
          at: Number.isNaN(at) ? Date.now() : at,
        }),
      };
      return {
        ...state,
        monitors: { ...state.monitors, [monitorId]: nextMonitor },
        pulseToken: {
          ...state.pulseToken,
          [monitorId]: (state.pulseToken[monitorId] ?? 0) + 1,
        },
      };
    }
    case 'status.change': {
      const { monitorId, to, from } = event.payload;
      const prev = state.monitors[monitorId] ?? EMPTY_MONITOR;
      return {
        ...state,
        monitors: {
          ...state.monitors,
          // An open incident still pins the displayed status to its severity
          // (a `status.change` and an `incident.open` ride the same outage; the
          // incident is the stronger signal and must not be downgraded by a
          // late status flip). Without an open incident the status follows.
          [monitorId]: { ...prev, status: prev.incidentSeverity ?? to },
        },
        announcement: `Monitor status changed from ${from} to ${to}.`,
      };
    }
    case 'incident.open': {
      const { incidentId, monitorId, severity, startedAt, cause } =
        event.payload;
      const prev = state.monitors[monitorId] ?? EMPTY_MONITOR;
      return {
        ...state,
        monitors: {
          ...state.monitors,
          // C-1 fan-out: force the card to the incident severity THIS tick, so
          // the card flips down at the exact moment the strip, the summary bar
          // and the toast react — one coordinated transition, no lag.
          [monitorId]: {
            ...prev,
            hasOpenIncident: true,
            incidentSeverity: severity,
            status: severity,
          },
        },
        incidents: {
          ...state.incidents,
          [incidentId]: {
            incidentId,
            monitorId,
            severity,
            startedAt,
            resolvedAt: null,
            status: 'open',
            cause,
            durationMs: null,
          },
        },
        incidentToken: state.incidentToken + 1,
      };
    }
    case 'incident.close': {
      const { incidentId, monitorId, startedAt, resolvedAt, durationMs } =
        event.payload;
      const prev = state.monitors[monitorId] ?? EMPTY_MONITOR;
      const prevIncident = state.incidents[incidentId];
      // A monitor may have several incidents over time; only clear the card
      // ring if no OTHER incident for this monitor is still open.
      const otherOpen = Object.values(state.incidents).find(
        (i) =>
          i.monitorId === monitorId &&
          i.incidentId !== incidentId &&
          i.status === 'open',
      );
      const stillOpenElsewhere = otherOpen != null;
      return {
        ...state,
        monitors: {
          ...state.monitors,
          [monitorId]: {
            ...prev,
            hasOpenIncident: stillOpenElsewhere,
            // If another incident for this monitor is still open, keep pinning
            // to ITS severity; otherwise release the pin so the recovery
            // `status.change` / `check.result` flips the card back to healthy.
            incidentSeverity: otherOpen?.severity ?? null,
            status: otherOpen?.severity ?? prev.status,
          },
        },
        incidents: {
          ...state.incidents,
          [incidentId]: {
            incidentId,
            monitorId,
            severity: prevIncident?.severity ?? 'down',
            startedAt,
            resolvedAt,
            status: 'resolved',
            cause: prevIncident?.cause ?? null,
            durationMs,
          },
        },
        incidentToken: state.incidentToken + 1,
      };
    }
    // `alert.fired` drives a toast handled at the SSE-client layer, not the
    // board store; `heartbeat` and any unmodelled type are no-ops here.
    case 'alert.fired':
    case 'heartbeat':
    default:
      return state;
  }
}

/**
 * Map a REST monitor row into a live-state slice, PRESERVING any live
 * sparkline / last-result we have already accumulated for it (the REST
 * snapshot is the reconciliation floor, not a reset — live points keep
 * accruing). A monitor the REST list no longer contains is dropped.
 */
function reconcile(
  monitors: readonly MonitorResponse[],
  existing: Readonly<Record<string, LiveMonitorState>>,
): Record<string, LiveMonitorState> {
  const next: Record<string, LiveMonitorState> = {};
  for (const m of monitors) {
    const prev = existing[m.id];
    // The REST `currentStatus` is the server's derived status; it is null
    // for a never-checked monitor (ADR-002), which we render as `unknown`.
    // If we already have a LIVE status (a result streamed in), keep it — it
    // is at least as fresh as the snapshot.
    const restStatus = restCurrentStatus(m);
    next[m.id] = prev
      ? { ...prev, status: prev.lastCheckedAt ? prev.status : restStatus }
      : { ...EMPTY_MONITOR, status: restStatus };
  }
  return next;
}

/**
 * The REST monitor shape carries `currentStatus` / `lastCheckedAt` from
 * Phase 2 (migration 0001). They are not in the base `monitorResponseSchema`
 * type yet, so we read them defensively off the row.
 */
function restCurrentStatus(m: MonitorResponse): DisplayStatus {
  const raw = (m as { currentStatus?: string | null }).currentStatus;
  if (raw === 'up' || raw === 'degraded' || raw === 'down') {
    return raw;
  }
  return 'unknown';
}

export const useLiveBoard = create<LiveBoardStore>((set) => ({
  monitors: {},
  pulseToken: {},
  announcement: null,
  incidents: {},
  incidentToken: 0,
  applyEvent: (event) => {
    set((state) => reduceLiveBoard(state, event));
  },
  hydrateFromRest: (monitors) => {
    set((state) => ({
      monitors: reconcile(monitors, state.monitors),
    }));
  },
  reset: () => {
    set({
      monitors: {},
      pulseToken: {},
      announcement: null,
      incidents: {},
      incidentToken: 0,
    });
  },
}));
