import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../config/app-config.service';
import type { AlertChannel, Incident, Monitor } from '../db/schema';

/**
 * Dispatch-time SSRF gate on the WEBHOOK target (reviewer must-fix #1, ADR-002)
 * — the AUTHORITATIVE check. Even if create-time passed, DNS can rebind, so the
 * dispatcher resolves-then-validates EVERY A/AAAA and PINS the connection. A
 * blocked target must NEVER open a socket: it records a `failed` delivery so the
 * de-dup constraint still holds and the worker job never throws.
 *
 * We mock `undici.request` to FAIL the test if it is ever called for a blocked
 * target (proving no socket is opened), and `node:dns` to model a hostname that
 * resolves to an internal IP (the rebinding case).
 */

const undiciRequest = vi.fn();
const dnsLookup = vi.fn();

vi.mock('undici', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('undici');
  return {
    ...actual,
    request: (...args: unknown[]) => undiciRequest(...args) as unknown,
  };
});

vi.mock('node:dns', () => ({
  promises: {
    lookup: (...args: unknown[]) => dnsLookup(...args) as unknown,
  },
}));

// Import AFTER the mocks are registered.
const { WebhookDispatcher } = await import('./webhook-dispatcher');

const monitor = {
  id: 'm-1',
  userId: 'u-1',
  name: 'Checkout API',
  targetUrl: 'https://api.example.com',
} as unknown as Monitor;

const incident = {
  id: 'i-1',
  monitorId: 'm-1',
  severity: 'down',
  startedAt: new Date('2026-06-04T10:00:00Z'),
  resolvedAt: null,
} as unknown as Incident;

function channel(target: string): AlertChannel {
  return {
    id: 'c-1',
    userId: 'u-1',
    type: 'webhook',
    target,
    secret: 'channel-secret-key',
    isEnabled: true,
  } as unknown as AlertChannel;
}

const config = { webhookSigningKey: 'server-key' } as unknown as AppConfigService;

function makeDispatcher() {
  return new WebhookDispatcher(config);
}

describe('WebhookDispatcher — dispatch-time SSRF gate', () => {
  beforeEach(() => {
    undiciRequest.mockReset();
    dnsLookup.mockReset();
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:9000/hook',
    'http://10.1.2.3/hook',
    'http://192.168.0.1/hook',
  ])('blocks a literal internal target %s WITHOUT opening a socket', async (target) => {
    const dispatcher = makeDispatcher();
    const result = await dispatcher.dispatch(channel(target), monitor, incident, 'open');

    expect(result).toEqual({ status: 'failed', responseCode: null, mock: false });
    expect(undiciRequest).not.toHaveBeenCalled(); // no socket opened
    expect(dnsLookup).not.toHaveBeenCalled(); // literal IP needs no DNS
  });

  it('blocks a hostname that RESOLVES to an internal IP (DNS rebinding) at dispatch', async () => {
    // The host passes the shape gate, but DNS resolves it to a private IP — the
    // resolve-then-validate step must reject it and never connect.
    dnsLookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);

    const dispatcher = makeDispatcher();
    const result = await dispatcher.dispatch(
      channel('https://rebind.attacker.example/hook'),
      monitor,
      incident,
      'open',
    );

    expect(result).toEqual({ status: 'failed', responseCode: null, mock: false });
    expect(dnsLookup).toHaveBeenCalledOnce();
    expect(undiciRequest).not.toHaveBeenCalled(); // blocked after resolve, no connect
  });

  it('fails-closed if ANY resolved record is internal (split-horizon answer)', async () => {
    // One public + one private record — the whole dispatch must be rejected.
    dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);

    const dispatcher = makeDispatcher();
    const result = await dispatcher.dispatch(
      channel('https://mixed.example/hook'),
      monitor,
      incident,
      'open',
    );

    expect(result.status).toBe('failed');
    expect(undiciRequest).not.toHaveBeenCalled();
  });

  it('delivers to a public target (resolves to a public IP) and pins the connection', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    undiciRequest.mockResolvedValue({
      statusCode: 200,
      body: { text: () => Promise.resolve('ok') },
    });

    const dispatcher = makeDispatcher();
    const result = await dispatcher.dispatch(
      channel('https://hooks.example.com/services/abc'),
      monitor,
      incident,
      'open',
    );

    expect(result).toEqual({ status: 'sent', responseCode: 200, mock: false });
    expect(undiciRequest).toHaveBeenCalledOnce();
    // The request must go through a PINNED dispatcher (anti-rebinding), not the
    // raw URL with default DNS.
    const callArgs = undiciRequest.mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({ method: 'POST', maxRedirections: 0 });
    expect((callArgs?.[1] as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });
});
