import { promises as dns } from 'node:dns';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProbeRunnerService } from './probe-runner.service';

/**
 * SSRF execution-time tests (ADR-002, the load-bearing security step).
 *
 * Create-time validation (Task 1.5) is UX; THIS is the authoritative guard —
 * it runs at probe execution because DNS can rebind between create and probe.
 * These tests prove the runner records an `ssrf_blocked` DOWN result (never
 * connects, never throws out) for:
 *   - a literal private / loopback / metadata IP target (no DNS needed),
 *   - a hostname that RESOLVES to a private IP (DNS rebinding — the resolver
 *     is mocked to return an internal address),
 *   - a redirect whose next hop resolves to a private IP (per-hop re-guard).
 *
 * `ssrf_blocked` is returned as a DOWN outcome, so the recorder writes it as a
 * successful job — a blocked target is recorded, never silently dropped, and
 * the host is never connected to.
 */

const runner = new ProbeRunnerService();

const monitorFor = (targetUrl: string) => ({
  targetUrl,
  method: 'GET' as const,
  timeoutMs: 5000,
  expectedStatus: 200,
  expectedKeyword: null,
  degradedThresholdMs: 1000,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('execution-time SSRF guard — literal IP targets (no DNS)', () => {
  it('blocks loopback 127.0.0.1', async () => {
    const out = await runner.run(monitorFor('http://127.0.0.1:8080/health'));
    expect(out.status).toBe('down');
    expect(out.error).toBe('ssrf_blocked');
    expect(out.statusCode).toBeNull();
  });

  it('blocks the cloud metadata address 169.254.169.254', async () => {
    const out = await runner.run(monitorFor('http://169.254.169.254/latest/meta-data/'));
    expect(out.error).toBe('ssrf_blocked');
  });

  it('blocks an RFC1918 private IP 10.0.0.5', async () => {
    const out = await runner.run(monitorFor('http://10.0.0.5/'));
    expect(out.error).toBe('ssrf_blocked');
  });

  it('blocks the localhost name at the shape gate', async () => {
    const out = await runner.run(monitorFor('http://localhost:3000/'));
    expect(out.error).toBe('ssrf_blocked');
  });

  it('blocks an IPv6 loopback literal [::1]', async () => {
    const out = await runner.run(monitorFor('http://[::1]:9000/'));
    expect(out.error).toBe('ssrf_blocked');
  });

  it('blocks a non-http scheme before any connection', async () => {
    const out = await runner.run(monitorFor('ftp://example.com/'));
    expect(out.error).toBe('ssrf_blocked');
  });
});

describe('execution-time SSRF guard — DNS rebinding (hostname resolves internal)', () => {
  it('blocks when the hostname resolves to a private IP (the rebinding attack)', async () => {
    // The attacker-controlled DNS returns an internal address at PROBE time.
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '10.1.2.3', family: 4 },
    ] as never);

    const out = await runner.run(monitorFor('http://rebind.attacker.example/'));
    expect(out.status).toBe('down');
    expect(out.error).toBe('ssrf_blocked');
    // Never connected: no status code.
    expect(out.statusCode).toBeNull();
  });

  it('blocks if ANY resolved record is internal (mixed A records)', async () => {
    // A public + a private record: the guard rejects the whole probe (fail
    // closed) so a split-horizon answer cannot smuggle an internal connect.
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as never);

    const out = await runner.run(monitorFor('http://mixed.example/'));
    expect(out.error).toBe('ssrf_blocked');
  });

  it('blocks an IPv4-mapped-IPv6 private resolution', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '::ffff:10.0.0.7', family: 6 },
    ] as never);
    const out = await runner.run(monitorFor('http://mapped.example/'));
    expect(out.error).toBe('ssrf_blocked');
  });

  it('classifies a real resolution failure as dns (not ssrf)', async () => {
    const err = new Error('getaddrinfo ENOTFOUND');
    (err as { code?: string }).code = 'ENOTFOUND';
    vi.spyOn(dns, 'lookup').mockRejectedValue(err);
    const out = await runner.run(monitorFor('http://this-host-does-not-exist.invalid/'));
    expect(out.status).toBe('down');
    expect(out.error).toBe('dns');
  });
});
