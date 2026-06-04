import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

import { Agent } from 'undici';

import { assertProbeUrlAllowed, assertResolvedIpsAllowed, SsrfBlockedError } from './ssrf-guard';

/**
 * Shared outbound-SSRF helpers (ADR-002, the SSRF-guard hard gate).
 *
 * Pulse has TWO outbound-HTTP surfaces that take a user-supplied target URL:
 *   1. the PROBER (`probe-runner.service.ts`) — checks arbitrary monitor URLs;
 *   2. the WEBHOOK DISPATCHER (`webhook-dispatcher.ts`) — POSTs an alert to a
 *      user-registered webhook URL.
 *
 * Both must run the SAME resolve-then-validate-then-pin guard so neither can be
 * pointed at the cloud metadata endpoint (169.254.169.254), loopback, link-local
 * or any RFC-1918 / ULA address. The prober historically inlined its own
 * `resolveAndValidate` + `buildPinnedAgent`; this module hoists that anti-rebinding
 * machinery so the webhook path reuses the EXACT same posture (resolve every
 * A/AAAA, fail-closed if ANY is internal, then PIN the connection to the validated
 * IP so a rebind between resolve and connect cannot slip through).
 *
 * Pure-by-design split: `assertProbeUrlAllowed` / `assertResolvedIpsAllowed`
 * (in `ssrf-guard.ts`) stay pure and exhaustively unit-tested; the IO (DNS
 * lookup) lives here.
 */

/**
 * Resolve `host`, validate EVERY resolved A/AAAA record against the denylist,
 * and return the first validated IP to pin the connection to.
 *
 * Throws {@link SsrfBlockedError} if any resolved IP is in a blocked range
 * (fail-closed — a split-horizon answer with one internal record rejects the
 * whole request), or a `dns`-classed error if resolution fails. A literal-IP
 * host is validated and returned directly (no DNS).
 */
export async function resolveAndAssertAllowed(host: string): Promise<string> {
  if (isIP(host) !== 0) {
    assertResolvedIpsAllowed([host]);
    return host;
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch (err) {
    const e = new Error(`dns lookup failed for ${host}`);
    e.name = 'OutboundDnsError';
    (e as { cause?: unknown }).cause = err;
    throw e;
  }

  const ips = records.map((r) => r.address);
  // Validate EVERY resolved record — if any is internal, reject outright.
  assertResolvedIpsAllowed(ips);

  const pinned = ips[0];
  if (pinned === undefined) {
    throw new SsrfBlockedError(`host ${host} did not resolve to any IP address`);
  }
  return pinned;
}

/**
 * Build a single-use undici `Agent` whose connect step ALWAYS resolves to the
 * pre-validated `pinnedIp`, regardless of what DNS would say at connect time —
 * the anti-rebinding pin. The Host header + TLS SNI still carry the original
 * hostname (undici derives SNI from the request URL), so virtual hosting +
 * certificate validation are unaffected. Close it after the request so its
 * socket does not leak.
 */
export function buildPinnedAgent(pinnedIp: string): Agent {
  const family = isIP(pinnedIp) === 6 ? 6 : 4;
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _options: unknown,
        cb: (
          err: NodeJS.ErrnoException | null,
          addresses: { address: string; family: number }[],
        ) => void,
      ): void => {
        cb(null, [{ address: pinnedIp, family }]);
      },
    },
    connections: 1,
    pipelining: 0,
  });
}

/**
 * The full outbound-URL guard for a NON-redirect-following POST (the webhook
 * path): shape-gate the URL, then resolve + validate + return both the parsed
 * URL and a pinned agent ready to dispatch with. Throws {@link SsrfBlockedError}
 * (or a dns-classed error) on any block. The caller closes the agent.
 */
export async function guardOutboundUrl(rawUrl: string): Promise<{ url: URL; agent: Agent }> {
  const { url, host } = assertProbeUrlAllowed(rawUrl);
  const pinnedIp = await resolveAndAssertAllowed(host);
  return { url, agent: buildPinnedAgent(pinnedIp) };
}
