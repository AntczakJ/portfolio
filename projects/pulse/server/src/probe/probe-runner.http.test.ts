import { promises as dns } from 'node:dns';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SsrfGuardModule from './ssrf-guard';

/**
 * Mock the SSRF guard module so `assertResolvedIpsAllowed` PERMITS the loopback
 * test server's IP for this suite (we are testing the HTTP runner, not the
 * guard). `assertProbeUrlAllowed` is kept REAL via importActual, so the
 * shape-gate's literal-IP short-circuit still rejects a redirect to a private
 * literal IP — that is what makes the redirect-per-hop-reguard test below
 * genuine. The guard's own logic is exhaustively tested in ssrf-guard.test.ts
 * (39 cases) and probe-runner.ssrf.test.ts.
 *
 * The hoisted `vi.mock` factory is the reliable ESM way to replace a named
 * export the runner imported by value (a runtime `vi.spyOn` does not rebind a
 * destructured import under ESM).
 */
vi.mock('./ssrf-guard', async (importActual) => {
  const actual = await importActual<typeof SsrfGuardModule>();
  return {
    ...actual,
    assertResolvedIpsAllowed: vi.fn(() => undefined),
  };
});

import { ProbeRunnerService } from './probe-runner.service';

/**
 * Probe runner HTTP-path integration tests (Task 2.1).
 *
 * These exercise the REAL HTTP execution path (undici request, manual redirect
 * following + per-hop re-guard, the 512 KB body cap, the keyword scan, the
 * up/degraded/down classification) against a real loopback HTTP server.
 *
 * To reach a loopback server we stub the IP allowlist (`assertResolvedIpsAllowed`)
 * to PERMIT the test server's IP for THIS SUITE ONLY — the SSRF guard itself is
 * tested with the real allowlist in probe-runner.ssrf.test.ts and ssrf-guard.
 * test.ts (39 cases). Here we are testing the HTTP runner, not the guard, so
 * allowing loopback is the correct isolation. The redirect-per-hop-reguard test
 * below re-enables the real guard on the SECOND hop to prove the per-hop check
 * blocks a rebinding redirect.
 */

// The test server is reached through a HOSTNAME (not a literal IP) so the real
// `assertProbeUrlAllowed` shape gate passes (a literal `127.0.0.1` URL would be
// blocked by the shape gate's literal-IP short-circuit, which calls the REAL
// guard internally and is unaffected by the module mock). `dns.lookup` is
// mocked to resolve the hostname to the loopback test server; the runner pins
// the connection to that IP. The `Host` header carries the hostname; the test
// server keys on path only, so it answers regardless.
const PROBE_HOST = 'probe-test.internal-fixture';

let server: Server;
let serverPort = 0;
let baseUrl: string;
const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const handler = handlers.get(path);
    if (handler) {
      handler(req, res);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  serverPort = addr.port;
  baseUrl = `http://${PROBE_HOST}:${String(serverPort)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  // Resolve the fixture hostname to the loopback test server. The runner
  // validates this IP via the (mocked-permissive) `assertResolvedIpsAllowed`
  // and pins the connection to it.
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
});

afterEach(() => {
  handlers.clear();
  vi.restoreAllMocks();
});

const runner = new ProbeRunnerService();

const monitorFor = (
  path: string,
  overrides: Partial<{ expectedStatus: number; expectedKeyword: string | null; degradedThresholdMs: number; timeoutMs: number }> = {},
) => ({
  targetUrl: `${baseUrl}${path}`,
  method: 'GET' as const,
  timeoutMs: overrides.timeoutMs ?? 5000,
  expectedStatus: overrides.expectedStatus ?? 200,
  expectedKeyword: overrides.expectedKeyword ?? null,
  degradedThresholdMs: overrides.degradedThresholdMs ?? 1000,
});

describe('probe runner — real HTTP classification', () => {
  it('records up for a 200 fast response', async () => {
    handlers.set('/ok', (_req, res) => {
      res.statusCode = 200;
      res.end('all good');
    });
    const out = await runner.run(monitorFor('/ok'));
    expect(out.status).toBe('up');
    expect(out.statusCode).toBe(200);
    expect(out.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(out.error).toBeNull();
  });

  it('records down (http_error) for a 500 — a SUCCESSFUL recording, not a throw', async () => {
    handlers.set('/boom', (_req, res) => {
      res.statusCode = 500;
      res.end('kaboom');
    });
    const out = await runner.run(monitorFor('/boom'));
    expect(out.status).toBe('down');
    expect(out.statusCode).toBe(500);
    expect(out.error).toBe('http_error');
  });

  it('records down (keyword_missing) when the keyword is absent', async () => {
    handlers.set('/body', (_req, res) => {
      res.statusCode = 200;
      res.end('the body says hello');
    });
    const out = await runner.run(monitorFor('/body', { expectedKeyword: 'GOODBYE' }));
    expect(out.status).toBe('down');
    expect(out.error).toBe('keyword_missing');
  });

  it('records up when the keyword is present', async () => {
    handlers.set('/body', (_req, res) => {
      res.statusCode = 200;
      res.end('{"status":"operational"}');
    });
    const out = await runner.run(monitorFor('/body', { expectedKeyword: 'operational' }));
    expect(out.status).toBe('up');
  });

  it('records degraded for a slow-but-OK response', async () => {
    handlers.set('/slow', (_req, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.end('slow ok');
      }, 120);
    });
    const out = await runner.run(monitorFor('/slow', { degradedThresholdMs: 50 }));
    expect(out.status).toBe('degraded');
    expect(out.statusCode).toBe(200);
  });

  it('records timeout (down) when the response exceeds the per-attempt timeout', async () => {
    handlers.set('/hang', () => {
      // never respond
    });
    const out = await runner.run(monitorFor('/hang', { timeoutMs: 150 }));
    expect(out.status).toBe('down');
    expect(out.error).toBe('timeout');
  });

  it('follows a redirect to a 200 (manual redirect handling)', async () => {
    handlers.set('/redirect', (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${baseUrl}/final`);
      res.end();
    });
    handlers.set('/final', (_req, res) => {
      res.statusCode = 200;
      res.end('arrived');
    });
    const out = await runner.run(monitorFor('/redirect'));
    expect(out.status).toBe('up');
    expect(out.statusCode).toBe(200);
  });

  it('caps the body at 512 KB and still finds an early keyword', async () => {
    handlers.set('/huge', (_req, res) => {
      res.statusCode = 200;
      // Keyword near the start, then a 2 MB filler that must be capped.
      res.write('MARKER');
      res.write('x'.repeat(2 * 1024 * 1024));
      res.end();
    });
    const out = await runner.run(monitorFor('/huge', { expectedKeyword: 'MARKER' }));
    expect(out.status).toBe('up');
  });
});

describe('probe runner — redirect per-hop re-guard (rebinding on hop 2)', () => {
  it('blocks a redirect whose Location resolves to a private IP', async () => {
    // Hop 1: allow the loopback test server (so we reach the redirect). The
    // server redirects to a literal private IP. The REAL guard runs on hop 2
    // (the private literal IP is rejected by the shape gate's literal-IP
    // short-circuit), so the spy must let hop 1 through but the literal-IP
    // hop 2 is blocked by assertProbeUrlAllowed BEFORE assertResolvedIpsAllowed
    // is consulted — so even with the spy active, hop 2 is blocked.
    handlers.set('/evil-redirect', (_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/latest/meta-data/');
      res.end();
    });
    const out = await runner.run(monitorFor('/evil-redirect'));
    expect(out.status).toBe('down');
    expect(out.error).toBe('ssrf_blocked');
  });
});
