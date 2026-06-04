import { describe, expect, it } from 'vitest';

import { parseSseEvent } from './event-schema';

/**
 * The client-side defensive parser must accept a well-formed envelope and
 * drop anything malformed (bad JSON, an unknown event type, a payload that
 * does not match) — a bad frame must never break a render.
 */
describe('parseSseEvent', () => {
  it('parses a well-formed check.result envelope', () => {
    const raw = JSON.stringify({
      id: 1,
      type: 'check.result',
      ts: 1_700_000_000_000,
      scope: 'dashboard:user-1',
      payload: {
        monitorId: '11111111-1111-1111-1111-111111111111',
        status: 'up',
        statusCode: 200,
        responseTimeMs: 120,
        checkedAt: '2026-06-03T12:00:00.000Z',
      },
    });
    const event = parseSseEvent(raw);
    expect(event?.type).toBe('check.result');
    if (event?.type === 'check.result') {
      expect(event.payload.responseTimeMs).toBe(120);
    }
  });

  it('parses a heartbeat envelope', () => {
    const raw = JSON.stringify({
      id: 2,
      type: 'heartbeat',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: { ts: 1_700_000_000_000 },
    });
    expect(parseSseEvent(raw)?.type).toBe('heartbeat');
  });

  it('returns null for non-JSON', () => {
    expect(parseSseEvent('not json {')).toBeNull();
  });

  it('returns null for an unknown event type', () => {
    const raw = JSON.stringify({
      id: 1,
      type: 'monitor.exploded',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: {},
    });
    expect(parseSseEvent(raw)).toBeNull();
  });

  it('returns null when the payload does not match the type', () => {
    const raw = JSON.stringify({
      id: 1,
      type: 'check.result',
      ts: 1,
      scope: 'dashboard:user-1',
      // missing required fields (monitorId, status, ...)
      payload: { responseTimeMs: 10 },
    });
    expect(parseSseEvent(raw)).toBeNull();
  });

  it('returns null when the envelope id is missing', () => {
    const raw = JSON.stringify({
      type: 'heartbeat',
      ts: 1,
      scope: 'dashboard:user-1',
      payload: { ts: 1 },
    });
    expect(parseSseEvent(raw)).toBeNull();
  });
});
