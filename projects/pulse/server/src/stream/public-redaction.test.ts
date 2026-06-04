import { describe, expect, it } from 'vitest';

import type { SseEvent } from '../lib/schemas/events';
import { redactForPublic } from './public-redaction';

/**
 * Public-stream redaction tests (Task 3.1, ADR-003) — the privacy boundary.
 *
 * The load-bearing assertion: `check.result` (raw response times) and
 * `alert.fired` (the owner's alerting) NEVER reach the public stream, regardless
 * of the published monitor set. The public surface exposes STRICTLY LESS — only
 * `status.change` / `incident.open` / `incident.close` for explicitly-published
 * monitors, re-scoped to `public:<pageId>`.
 */

const MON_PUBLIC = '11111111-1111-1111-1111-111111111111';
const MON_PRIVATE = '22222222-2222-2222-2222-222222222222';
const INCIDENT = '33333333-3333-3333-3333-333333333333';
const PAGE_ID = 'page-abc';
const allowed = new Set([MON_PUBLIC]);

const SOURCE_SCOPE = 'dashboard:owner-1' as const;

function checkResult(monitorId: string): SseEvent {
  return {
    id: 1,
    type: 'check.result',
    ts: 1000,
    scope: SOURCE_SCOPE,
    payload: { monitorId, status: 'up', statusCode: 200, responseTimeMs: 42, checkedAt: '2026-06-03T00:00:00.000Z' },
  };
}

function statusChange(monitorId: string): SseEvent {
  return {
    id: 2,
    type: 'status.change',
    ts: 2000,
    scope: SOURCE_SCOPE,
    payload: { monitorId, from: 'up', to: 'down', at: '2026-06-03T00:00:01.000Z' },
  };
}

function incidentOpen(monitorId: string): SseEvent {
  return {
    id: 3,
    type: 'incident.open',
    ts: 3000,
    scope: SOURCE_SCOPE,
    payload: { incidentId: INCIDENT, monitorId, severity: 'down', startedAt: '2026-06-03T00:00:01.000Z', cause: 'http_error' },
  };
}

function incidentClose(monitorId: string): SseEvent {
  return {
    id: 4,
    type: 'incident.close',
    ts: 4000,
    scope: SOURCE_SCOPE,
    payload: { incidentId: INCIDENT, monitorId, startedAt: '2026-06-03T00:00:01.000Z', resolvedAt: '2026-06-03T00:05:01.000Z', durationMs: 300000 },
  };
}

function alertFired(monitorId: string): SseEvent {
  return {
    id: 5,
    type: 'alert.fired',
    ts: 5000,
    scope: SOURCE_SCOPE,
    payload: { incidentId: INCIDENT, monitorId, channelType: 'webhook', transition: 'open', deliveredAt: '2026-06-03T00:00:02.000Z', status: 'sent' },
  };
}

describe('redactForPublic — the public stream exposes strictly less', () => {
  it('DROPS check.result even for a published monitor (raw response times are private)', () => {
    expect(redactForPublic(checkResult(MON_PUBLIC), PAGE_ID, allowed)).toBeNull();
  });

  it('DROPS alert.fired even for a published monitor (the owner alerting is private)', () => {
    expect(redactForPublic(alertFired(MON_PUBLIC), PAGE_ID, allowed)).toBeNull();
  });

  it('passes status.change for a published monitor, re-scoped to public:<pageId>', () => {
    const out = redactForPublic(statusChange(MON_PUBLIC), PAGE_ID, allowed);
    expect(out).not.toBeNull();
    expect(out?.scope).toBe(`public:${PAGE_ID}`);
    expect(out?.type).toBe('status.change');
  });

  it('passes incident.open / incident.close for a published monitor', () => {
    expect(redactForPublic(incidentOpen(MON_PUBLIC), PAGE_ID, allowed)?.type).toBe('incident.open');
    expect(redactForPublic(incidentClose(MON_PUBLIC), PAGE_ID, allowed)?.type).toBe('incident.close');
  });

  it('DROPS allowed event types for a monitor NOT on the page (not published)', () => {
    expect(redactForPublic(statusChange(MON_PRIVATE), PAGE_ID, allowed)).toBeNull();
    expect(redactForPublic(incidentOpen(MON_PRIVATE), PAGE_ID, allowed)).toBeNull();
  });

  it('preserves the source envelope id (the Last-Event-ID cursor) across redaction', () => {
    const ev = { ...statusChange(MON_PUBLIC), id: 99 };
    expect(redactForPublic(ev, PAGE_ID, allowed)?.id).toBe(99);
  });

  it('NEVER leaks a private type across an exhaustive sweep of the vocabulary', () => {
    // For EVERY event type, asserting the privacy invariant directly: only the
    // three allowed types (for a published monitor) survive; everything else is
    // dropped. This is the proof the public stream cannot carry raw timings or
    // alerts by any path.
    const samples: { event: SseEvent; shouldPass: boolean }[] = [
      { event: checkResult(MON_PUBLIC), shouldPass: false },
      { event: alertFired(MON_PUBLIC), shouldPass: false },
      { event: statusChange(MON_PUBLIC), shouldPass: true },
      { event: incidentOpen(MON_PUBLIC), shouldPass: true },
      { event: incidentClose(MON_PUBLIC), shouldPass: true },
    ];
    for (const { event, shouldPass } of samples) {
      const out = redactForPublic(event, PAGE_ID, allowed);
      expect(out !== null, `${event.type} pass=${String(shouldPass)}`).toBe(shouldPass);
      if (out) {
        // Sanity: no passed event is ever a private type.
        expect(out.type === 'check.result' || out.type === 'alert.fired').toBe(false);
      }
    }
  });
});
