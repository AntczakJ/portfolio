import { isIP } from 'node:net';

/**
 * SSRF guard (ADR-002, AGENT_NOTES "SSRF guard is a hard gate") — the
 * project's main attack surface. The prober is an outbound-HTTP primitive
 * fed arbitrary user-supplied target URLs, so without this guard a monitor
 * could be pointed at internal services, the cloud metadata endpoint
 * (169.254.169.254), or loopback to exfiltrate data / pivot inside the VPC.
 *
 * Design (resolve-then-pin, run twice):
 *   1. Scheme allowlist — only http/https.
 *   2. Reject credentialed URLs (`user:pass@host`).
 *   3. At probe time: DNS-resolve the host, check EVERY resolved A/AAAA
 *      record against the denylist, then connect to the validated IP
 *      (pinning) so a rebind between resolve and connect cannot slip through;
 *      re-run on every redirect hop.
 *
 * This module provides the two PURE pieces that are exhaustively unit-tested
 * and reused by both the create-time check (Task 1.5) and the Phase 2 prober:
 *
 *   - `assertProbeUrlAllowed(url)` — the URL-shape gate (scheme,
 *     credentials, and a literal-IP-in-the-host short-circuit). Runs at
 *     monitor-create/edit validation (fail fast) AND as the first step at
 *     probe time.
 *   - `assertResolvedIpsAllowed(ips)` — the authoritative IP gate the prober
 *     calls AFTER DNS resolution (Phase 2.1) for every resolved address and
 *     every redirect hop.
 *
 * The DNS resolution itself lives in the prober (Phase 2.1) because it is IO;
 * keeping these functions pure is what makes the denylist exhaustively
 * testable (Task 8.1).
 */

/** A blocked-target error the prober maps to the `ssrf_blocked` result class. */
export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`SSRF guard rejected target: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Hostnames that are loopback aliases by definition and must be blocked at the
 * shape gate, before DNS (a resolver / hosts file could even point `localhost`
 * elsewhere, but the *name* is a known internal alias and a recruiter testing
 * the guard will reach for it). Defense in depth: the authoritative DNS+IP
 * check (`assertResolvedIpsAllowed`) still runs at probe time and would also
 * catch a 127.x resolution.
 */
const BLOCKED_HOST_NAMES = new Set(['localhost']);

/** True if `host` is a blocked loopback alias name (exact or a subdomain). */
function isBlockedHostName(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOST_NAMES.has(lower)) return true;
  // `*.localhost` is reserved as loopback (RFC 6761).
  return lower.endsWith('.localhost');
}

/**
 * Parse an IPv4 dotted-quad to its 32-bit unsigned integer, or null if it is
 * not a valid IPv4 literal.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc >>> 0;
}

/** True if `ip` (an IPv4 literal) falls inside `base/prefixBits`. */
function ipv4InCidr(ipInt: number, baseCidr: string): boolean {
  const [base, bitsRaw] = baseCidr.split('/');
  const baseInt = ipv4ToInt(base ?? '');
  if (baseInt === null) return false;
  const bits = Number(bitsRaw);
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * The IPv4 denylist (ADR-002). Every block here would let a probe reach
 * something it must not. Ordered roughly by likelihood for readability.
 */
const IPV4_DENY_CIDRS = [
  '0.0.0.0/8', // "this host" / unspecified
  '10.0.0.0/8', // RFC 1918 private
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local — INCLUDES 169.254.169.254 cloud metadata
  '172.16.0.0/12', // RFC 1918 private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1 (documentation)
  '192.168.0.0/16', // RFC 1918 private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved / future use (covers 255.255.255.255 broadcast)
] as const;

/** Reason an IPv4 address is blocked, or null if it is allowed. */
function ipv4BlockReason(ip: string): string | null {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return 'malformed IPv4 address';
  for (const cidr of IPV4_DENY_CIDRS) {
    if (ipv4InCidr(ipInt, cidr)) return `IPv4 ${ip} is in blocked range ${cidr}`;
  }
  return null;
}

/**
 * Expand an IPv6 literal to its eight 16-bit hextet integers, handling `::`
 * compression and embedded IPv4 (e.g. `::ffff:1.2.3.4`). Returns null on a
 * malformed address.
 */
function ipv6ToHextets(input: string): number[] | null {
  let ip = input.trim();
  // Strip a zone id (`fe80::1%eth0`) — it does not affect range classification.
  const pct = ip.indexOf('%');
  if (pct !== -1) ip = ip.slice(0, pct);

  // Handle an embedded IPv4 tail by converting it to two hextets.
  let v4Tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const tail = lastColon === -1 ? '' : ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    v4Tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    ip = ip.slice(0, lastColon + 1) + '0:0';
  }

  const doubleColon = ip.indexOf('::');
  let headParts: string[];
  let tailParts: string[];
  if (doubleColon === -1) {
    headParts = ip.split(':');
    tailParts = [];
  } else {
    const before = ip.slice(0, doubleColon);
    const after = ip.slice(doubleColon + 2);
    headParts = before === '' ? [] : before.split(':');
    tailParts = after === '' ? [] : after.split(':');
  }

  const parseHextet = (h: string): number | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    return parseInt(h, 16);
  };

  const head: number[] = [];
  for (const h of headParts) {
    const n = parseHextet(h);
    if (n === null) return null;
    head.push(n);
  }
  const tailHextets: number[] = [];
  for (const h of tailParts) {
    const n = parseHextet(h);
    if (n === null) return null;
    tailHextets.push(n);
  }

  // The v4 tail (if any) was appended to the textual tail before splitting via
  // the `0:0` substitution; re-attach its real value.
  const fullTail = v4Tail.length > 0 ? [...tailHextets.slice(0, -2), ...v4Tail] : tailHextets;

  const total = head.length + fullTail.length;
  if (doubleColon === -1) {
    if (total !== 8) return null;
    return head;
  }
  if (total > 8) return null;
  const zeros = new Array<number>(8 - total).fill(0);
  return [...head, ...zeros, ...fullTail];
}

/** Reason an IPv6 address is blocked, or null if it is allowed. */
function ipv6BlockReason(ip: string): string | null {
  const hextets = ipv6ToHextets(ip);
  if (hextets?.length !== 8) return 'malformed IPv6 address';

  const [h0, h1, , , , h5, h6, h7] = hextets as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // Loopback ::1
  if (hextets.every((h, i) => (i === 7 ? h === 1 : h === 0))) {
    return `IPv6 ${ip} is loopback (::1)`;
  }
  // Unspecified ::
  if (hextets.every((h) => h === 0)) return `IPv6 ${ip} is unspecified (::)`;

  // IPv4-mapped ::ffff:0:0/96 — decode the embedded IPv4 and re-check it
  // against the IPv4 denylist (a mapped address can carry a private v4).
  if (h0 === 0 && h1 === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && h5 === 0xffff) {
    const v4Octets = [(h6 >> 8) & 0xff, h6 & 0xff, (h7 >> 8) & 0xff, h7 & 0xff];
    const v4 = v4Octets.map((o) => o.toString(10)).join('.');
    const v4Reason = ipv4BlockReason(v4);
    if (v4Reason) return `IPv4-mapped IPv6 ${ip} -> ${v4Reason}`;
    // A mapped public IPv4 is itself suspicious as a probe target; block it.
    return `IPv4-mapped IPv6 ${ip} is not allowed (use the IPv4 form)`;
  }

  // ULA fc00::/7 (first 7 bits = 1111 110)
  if ((h0 & 0xfe00) === 0xfc00) return `IPv6 ${ip} is ULA (fc00::/7)`;
  // Link-local fe80::/10 (first 10 bits = 1111 1110 10)
  if ((h0 & 0xffc0) === 0xfe80) return `IPv6 ${ip} is link-local (fe80::/10)`;
  // Multicast ff00::/8
  if ((h0 & 0xff00) === 0xff00) return `IPv6 ${ip} is multicast (ff00::/8)`;

  return null;
}

/**
 * The authoritative IP gate. The prober (Phase 2.1) calls this with EVERY
 * resolved A/AAAA record before connecting, and again on every redirect hop's
 * resolved IP. Throws `SsrfBlockedError` if any address is in a blocked range.
 *
 * Pure: no DNS, no IO — the caller supplies the already-resolved IPs.
 */
export function assertResolvedIpsAllowed(ips: readonly string[]): void {
  if (ips.length === 0) {
    throw new SsrfBlockedError('host did not resolve to any IP address');
  }
  for (const ip of ips) {
    const family = isIP(ip);
    let reason: string | null;
    if (family === 4) {
      reason = ipv4BlockReason(ip);
    } else if (family === 6) {
      reason = ipv6BlockReason(ip);
    } else {
      reason = `not a valid IP address: ${ip}`;
    }
    if (reason) throw new SsrfBlockedError(reason);
  }
}

/**
 * The URL-shape gate (Task 1.5). Validates scheme + credentials, and if the
 * host is already a literal IP, checks it against the denylist immediately
 * (no DNS needed). Returns the parsed URL + the host on success so the prober
 * can resolve it.
 *
 * Runs at monitor-create/edit validation (fail fast — reject obviously
 * internal targets with a clear API error) AND as the first step at probe
 * time. The DNS+IP check (`assertResolvedIpsAllowed`) is the authoritative
 * one because DNS can rebind between create and run.
 */
export function assertProbeUrlAllowed(rawUrl: string): { url: URL; host: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`not a valid absolute URL: ${rawUrl}`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfBlockedError(`scheme ${url.protocol} is not allowed (only http/https)`);
  }

  // Credentialed URLs (`http://user:pass@host`) are rejected outright — a
  // common SSRF-smuggling and credential-leak vector.
  if (url.username !== '' || url.password !== '') {
    throw new SsrfBlockedError('credentialed URLs (user:pass@host) are not allowed');
  }

  // `url.hostname` keeps the brackets on an IPv6 literal (`[::1]`); strip them
  // so `isIP` recognises the address and the prober gets a resolver-ready
  // host. The port is already excluded from `hostname`.
  const rawHost = url.hostname;
  if (rawHost === '') {
    throw new SsrfBlockedError('URL has no host');
  }
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;

  // Block well-known loopback alias names (localhost, *.localhost) at the
  // shape gate — they are internal by definition.
  if (isBlockedHostName(host)) {
    throw new SsrfBlockedError(`host ${host} is a blocked loopback alias`);
  }

  // If the host is itself a literal IP, validate it now — no DNS step needed,
  // and a literal-IP internal target is the most direct attack.
  const family = isIP(host);
  if (family !== 0) {
    assertResolvedIpsAllowed([host]);
  }

  return { url, host };
}
