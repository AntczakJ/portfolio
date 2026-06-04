import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { Incident, Monitor } from '../db/schema';
import {
  buildWebhookPayload,
  signWebhookBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from './webhook-payload';

/**
 * Webhook signing + payload tests (Task 5.2, ADR-005). These assert the EXACT
 * bytes a receiver recomputes — the security contract of the signed webhook.
 */

const monitor = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'API',
  targetUrl: 'https://api.example.com/health',
} as Pick<Monitor, 'id' | 'name' | 'targetUrl'>;

const openIncident = {
  id: '22222222-2222-2222-2222-222222222222',
  severity: 'down',
  startedAt: new Date('2026-06-04T10:00:00.000Z'),
  resolvedAt: null,
} as Pick<Incident, 'id' | 'severity' | 'startedAt' | 'resolvedAt'>;

const closedIncident = {
  id: '22222222-2222-2222-2222-222222222222',
  severity: 'down',
  startedAt: new Date('2026-06-04T10:00:00.000Z'),
  resolvedAt: new Date('2026-06-04T10:00:30.000Z'),
} as Pick<Incident, 'id' | 'severity' | 'startedAt' | 'resolvedAt'>;

describe('signWebhookBody — the HMAC-SHA256 scheme', () => {
  it('signs `<timestamp>.<rawBody>` and prefixes `sha256=`', () => {
    const rawBody = '{"hello":"world"}';
    const ts = 1_750_000_000;
    const key = 'super-secret-key';

    const sig = signWebhookBody(rawBody, ts, key);

    // The receiver recomputes exactly this.
    const expectedHex = createHmac('sha256', key).update(`${String(ts)}.${rawBody}`).digest('hex');
    expect(sig).toBe(`sha256=${expectedHex}`);
  });

  it('is sensitive to the timestamp (replay binding)', () => {
    const rawBody = '{"a":1}';
    const key = 'k';
    expect(signWebhookBody(rawBody, 1000, key)).not.toBe(signWebhookBody(rawBody, 1001, key));
  });

  it('is sensitive to the body and the key', () => {
    const key = 'k';
    expect(signWebhookBody('{"a":1}', 1000, key)).not.toBe(signWebhookBody('{"a":2}', 1000, key));
    expect(signWebhookBody('{"a":1}', 1000, 'k1')).not.toBe(signWebhookBody('{"a":1}', 1000, 'k2'));
  });

  it('a receiver can verify a real built payload end-to-end', () => {
    const now = new Date('2026-06-04T10:00:01.000Z');
    const payload = buildWebhookPayload(monitor, openIncident, 'open', now);
    const rawBody = JSON.stringify(payload);
    const ts = Math.floor(now.getTime() / 1000);
    const key = 'channel-secret';

    const headerSig = signWebhookBody(rawBody, ts, key);

    // Receiver side: recompute over `<X-Pulse-Timestamp>.<rawBody>` with the key.
    const recomputed = `sha256=${createHmac('sha256', key)
      .update(`${String(ts)}.${rawBody}`)
      .digest('hex')}`;
    expect(headerSig).toBe(recomputed);
  });

  it('the header names are the documented constants', () => {
    expect(SIGNATURE_HEADER).toBe('X-Pulse-Signature');
    expect(TIMESTAMP_HEADER).toBe('X-Pulse-Timestamp');
  });
});

describe('buildWebhookPayload — the typed body', () => {
  it('open payload carries monitor + incident + null resolvedAt/durationMs', () => {
    const now = new Date('2026-06-04T10:00:01.000Z');
    const payload = buildWebhookPayload(monitor, openIncident, 'open', now);
    expect(payload).toEqual({
      version: 1,
      transition: 'open',
      monitor: { id: monitor.id, name: 'API', targetUrl: 'https://api.example.com/health' },
      incident: {
        id: openIncident.id,
        severity: 'down',
        startedAt: '2026-06-04T10:00:00.000Z',
        resolvedAt: null,
        durationMs: null,
      },
      timestamp: '2026-06-04T10:00:01.000Z',
    });
  });

  it('close payload carries resolvedAt + computed durationMs', () => {
    const now = new Date('2026-06-04T10:00:30.000Z');
    const payload = buildWebhookPayload(monitor, closedIncident, 'close', now);
    expect(payload.transition).toBe('close');
    expect(payload.incident.resolvedAt).toBe('2026-06-04T10:00:30.000Z');
    expect(payload.incident.durationMs).toBe(30_000);
  });
});
