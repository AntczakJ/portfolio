import { describe, expect, it } from 'vitest';

import {
  reduceLiveBoard,
  SPARKLINE_BUFFER_SIZE,
  type LiveBoardState,
} from './live-store';
import type { SseEvent } from 'pulse-server/events';

/**
 * The live-board reducer is the heart of the wow moment: a `check.result`
 * must update the card metric + push a sparkline point; a `status.change`
 * must flip the card status + queue an announcement; out-of-scope /
 * unmodelled events must be no-ops. Pure, so tested without a browser.
 */

const EMPTY: LiveBoardState = {
  monitors: {},
  pulseToken: {},
  announcement: null,
  incidents: {},
  incidentToken: 0,
};

const MONITOR_ID = '11111111-1111-1111-1111-111111111111';

function checkResult(
  overrides: Partial<{
    status: 'up' | 'degraded' | 'down';
    responseTimeMs: number | null;
    statusCode: number | null;
    checkedAt: string;
    id: number;
  }> = {},
): SseEvent {
  return {
    id: overrides.id ?? 1,
    type: 'check.result',
    ts: 1_700_000_000_000,
    scope: 'dashboard:user-1',
    payload: {
      monitorId: MONITOR_ID,
      status: overrides.status ?? 'up',
      statusCode: overrides.statusCode ?? 200,
      responseTimeMs:
        overrides.responseTimeMs === undefined ? 123 : overrides.responseTimeMs,
      checkedAt: overrides.checkedAt ?? '2026-06-03T12:00:00.000Z',
    },
  };
}

function statusChange(from: 'up' | 'down', to: 'up' | 'down'): SseEvent {
  return {
    id: 2,
    type: 'status.change',
    ts: 1_700_000_000_000,
    scope: 'dashboard:user-1',
    payload: {
      monitorId: MONITOR_ID,
      from,
      to,
      at: '2026-06-03T12:01:00.000Z',
    },
  };
}

describe('reduceLiveBoard — check.result', () => {
  it('updates the card metric and appends a sparkline point', () => {
    const next = reduceLiveBoard(
      EMPTY,
      checkResult({ status: 'up', responseTimeMs: 250, statusCode: 200 }),
    );
    const m = next.monitors[MONITOR_ID];
    expect(m).toBeDefined();
    expect(m?.status).toBe('up');
    expect(m?.lastResponseTimeMs).toBe(250);
    expect(m?.lastStatusCode).toBe(200);
    expect(m?.lastCheckedAt).toBe(Date.parse('2026-06-03T12:00:00.000Z'));
    expect(m?.sparkline).toHaveLength(1);
    expect(m?.sparkline[0]).toMatchObject({ value: 250, status: 'up' });
  });

  it('bumps the per-monitor pulse token on each fresh result', () => {
    const a = reduceLiveBoard(EMPTY, checkResult({ id: 1 }));
    expect(a.pulseToken[MONITOR_ID]).toBe(1);
    const b = reduceLiveBoard(a, checkResult({ id: 2 }));
    expect(b.pulseToken[MONITOR_ID]).toBe(2);
  });

  it('accumulates points in order across multiple results', () => {
    let state = EMPTY;
    for (const ms of [100, 200, 300]) {
      state = reduceLiveBoard(state, checkResult({ responseTimeMs: ms }));
    }
    expect(state.monitors[MONITOR_ID]?.sparkline.map((p) => p.value)).toEqual([
      100, 200, 300,
    ]);
    // The latest result is the visible metric.
    expect(state.monitors[MONITOR_ID]?.lastResponseTimeMs).toBe(300);
  });

  it('caps the rolling buffer at SPARKLINE_BUFFER_SIZE (drops oldest)', () => {
    let state = EMPTY;
    const total = SPARKLINE_BUFFER_SIZE + 10;
    for (let i = 0; i < total; i += 1) {
      state = reduceLiveBoard(state, checkResult({ responseTimeMs: i }));
    }
    const buf = state.monitors[MONITOR_ID]?.sparkline ?? [];
    expect(buf).toHaveLength(SPARKLINE_BUFFER_SIZE);
    // Oldest kept point is index (total - SIZE); newest is total-1.
    expect(buf[0]?.value).toBe(total - SPARKLINE_BUFFER_SIZE);
    expect(buf.at(-1)?.value).toBe(total - 1);
  });

  it('records a null response time as a gap point (transport error)', () => {
    const next = reduceLiveBoard(
      EMPTY,
      checkResult({ status: 'down', responseTimeMs: null, statusCode: null }),
    );
    const m = next.monitors[MONITOR_ID];
    expect(m?.lastResponseTimeMs).toBeNull();
    expect(m?.sparkline[0]?.value).toBeNull();
    expect(m?.status).toBe('down');
  });
});

describe('reduceLiveBoard — status.change', () => {
  it('flips the monitor status and queues a polite announcement', () => {
    const seeded = reduceLiveBoard(EMPTY, checkResult({ status: 'up' }));
    const next = reduceLiveBoard(seeded, statusChange('up', 'down'));
    expect(next.monitors[MONITOR_ID]?.status).toBe('down');
    expect(next.announcement).toContain('up');
    expect(next.announcement).toContain('down');
  });

  it('creates the monitor slice if the status change arrives first', () => {
    const next = reduceLiveBoard(EMPTY, statusChange('up', 'down'));
    expect(next.monitors[MONITOR_ID]?.status).toBe('down');
  });

  it('preserves the sparkline buffer across a status flip', () => {
    let state = reduceLiveBoard(EMPTY, checkResult({ responseTimeMs: 500 }));
    state = reduceLiveBoard(state, statusChange('up', 'down'));
    expect(state.monitors[MONITOR_ID]?.sparkline).toHaveLength(1);
    expect(state.monitors[MONITOR_ID]?.sparkline[0]?.value).toBe(500);
  });
});

describe('reduceLiveBoard — incidents', () => {
  it('marks an open incident and clears it on close', () => {
    const open: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'http_error',
      },
    };
    const close: SseEvent = {
      id: 4,
      type: 'incident.close',
      ts: 2,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        startedAt: '2026-06-03T12:00:00.000Z',
        resolvedAt: '2026-06-03T12:05:00.000Z',
        durationMs: 300_000,
      },
    };
    const opened = reduceLiveBoard(EMPTY, open);
    expect(opened.monitors[MONITOR_ID]?.hasOpenIncident).toBe(true);
    const closed = reduceLiveBoard(opened, close);
    expect(closed.monitors[MONITOR_ID]?.hasOpenIncident).toBe(false);
  });

  it('flips the card status to the incident severity the SAME tick (C-1)', () => {
    // The card must go down atomically with the incident opening — not wait for
    // a separate, later status.change. A monitor that was reading `up` flips to
    // the incident severity immediately on incident.open.
    const seeded = reduceLiveBoard(EMPTY, checkResult({ status: 'up' }));
    expect(seeded.monitors[MONITOR_ID]?.status).toBe('up');
    const open: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'down after 3 consecutive down checks',
      },
    };
    const opened = reduceLiveBoard(seeded, open);
    expect(opened.monitors[MONITOR_ID]?.status).toBe('down');
    expect(opened.monitors[MONITOR_ID]?.incidentSeverity).toBe('down');
  });

  it('keeps the card pinned to the severity while the incident is open', () => {
    const open: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'http_error',
      },
    };
    let state = reduceLiveBoard(EMPTY, open);
    // A stray `up` probe mid-incident must NOT un-flip the card; the metric
    // still updates but the status stays pinned down until the incident closes.
    state = reduceLiveBoard(state, checkResult({ status: 'up', responseTimeMs: 90 }));
    expect(state.monitors[MONITOR_ID]?.status).toBe('down');
    expect(state.monitors[MONITOR_ID]?.lastResponseTimeMs).toBe(90);
    // A late status.change to up is likewise ignored while pinned.
    state = reduceLiveBoard(state, statusChange('down', 'up'));
    expect(state.monitors[MONITOR_ID]?.status).toBe('down');
  });

  it('releases the pin on close so recovery can flip the card back up', () => {
    const open: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'http_error',
      },
    };
    const close: SseEvent = {
      id: 4,
      type: 'incident.close',
      ts: 2,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        startedAt: '2026-06-03T12:00:00.000Z',
        resolvedAt: '2026-06-03T12:05:00.000Z',
        durationMs: 300_000,
      },
    };
    let state = reduceLiveBoard(EMPTY, open);
    state = reduceLiveBoard(state, close);
    expect(state.monitors[MONITOR_ID]?.incidentSeverity).toBeNull();
    // Now a recovery result flips the card back up (the pin is gone).
    state = reduceLiveBoard(state, checkResult({ status: 'up', responseTimeMs: 75 }));
    expect(state.monitors[MONITOR_ID]?.status).toBe('up');
  });

  it('records an open incident row in the incidents slice', () => {
    const open: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'down after 3 consecutive down checks',
      },
    };
    const next = reduceLiveBoard(EMPTY, open);
    const row = next.incidents['inc-1'];
    expect(row).toBeDefined();
    expect(row?.status).toBe('open');
    expect(row?.severity).toBe('down');
    expect(row?.resolvedAt).toBeNull();
    expect(row?.durationMs).toBeNull();
    expect(row?.cause).toBe('down after 3 consecutive down checks');
    // The open bumps the incident token (drives the view's reconcile / re-sort).
    expect(next.incidentToken).toBe(1);
  });

  it('stamps the resolution onto the incident row on close', () => {
    const open: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'http_error',
      },
    };
    const close: SseEvent = {
      id: 4,
      type: 'incident.close',
      ts: 2,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        startedAt: '2026-06-03T12:00:00.000Z',
        resolvedAt: '2026-06-03T12:05:00.000Z',
        durationMs: 300_000,
      },
    };
    const next = reduceLiveBoard(reduceLiveBoard(EMPTY, open), close);
    const row = next.incidents['inc-1'];
    expect(row?.status).toBe('resolved');
    expect(row?.resolvedAt).toBe('2026-06-03T12:05:00.000Z');
    expect(row?.durationMs).toBe(300_000);
    // The severity + cause carried over from the open row.
    expect(row?.severity).toBe('down');
    expect(row?.cause).toBe('http_error');
    expect(next.incidentToken).toBe(2);
  });

  it('keeps the card ring lit when another incident for the monitor stays open', () => {
    const openA: SseEvent = {
      id: 3,
      type: 'incident.open',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-a',
        monitorId: MONITOR_ID,
        severity: 'degraded',
        startedAt: '2026-06-03T12:00:00.000Z',
        cause: 'degraded',
      },
    };
    const openB: SseEvent = {
      id: 4,
      type: 'incident.open',
      ts: 2,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-b',
        monitorId: MONITOR_ID,
        severity: 'down',
        startedAt: '2026-06-03T12:01:00.000Z',
        cause: 'down',
      },
    };
    const closeA: SseEvent = {
      id: 5,
      type: 'incident.close',
      ts: 3,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-a',
        monitorId: MONITOR_ID,
        startedAt: '2026-06-03T12:00:00.000Z',
        resolvedAt: '2026-06-03T12:02:00.000Z',
        durationMs: 120_000,
      },
    };
    let state = reduceLiveBoard(EMPTY, openA);
    state = reduceLiveBoard(state, openB);
    state = reduceLiveBoard(state, closeA);
    // inc-b is still open, so the monitor's ring must remain.
    expect(state.monitors[MONITOR_ID]?.hasOpenIncident).toBe(true);
    expect(state.incidents['inc-a']?.status).toBe('resolved');
    expect(state.incidents['inc-b']?.status).toBe('open');
  });
});

describe('reduceLiveBoard — no-ops', () => {
  it('ignores heartbeat (state identity unchanged)', () => {
    const seeded = reduceLiveBoard(EMPTY, checkResult());
    const heartbeat: SseEvent = {
      id: 9,
      type: 'heartbeat',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: { ts: 1_700_000_000_000 },
    };
    const next = reduceLiveBoard(seeded, heartbeat);
    expect(next).toBe(seeded);
  });

  it('ignores alert.fired in the board store (handled by the toast layer)', () => {
    const seeded = reduceLiveBoard(EMPTY, checkResult());
    const alert: SseEvent = {
      id: 10,
      type: 'alert.fired',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {
        incidentId: 'inc-1',
        monitorId: MONITOR_ID,
        channelType: 'webhook',
        transition: 'open',
        deliveredAt: '2026-06-03T12:00:00.000Z',
        status: 'sent',
      },
    };
    const next = reduceLiveBoard(seeded, alert);
    expect(next).toBe(seeded);
  });
});
