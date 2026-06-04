import { describe, expect, it } from 'vitest';

import {
  assertProbeUrlAllowed,
  assertResolvedIpsAllowed,
  SsrfBlockedError,
} from './ssrf-guard';

/**
 * SSRF guard unit tests (Task 1.5 / Task 8.1) — the project's main attack
 * surface, so the coverage is deliberately exhaustive: private ranges, the
 * cloud metadata IP, localhost, non-http schemes, credentialed URLs, and IPv6
 * forms (loopback, ULA, link-local, IPv4-mapped).
 */

describe('assertProbeUrlAllowed — scheme allowlist', () => {
  it.each(['ftp://example.com', 'file:///etc/passwd', 'gopher://x', 'data:text/plain,hi', 'ws://x'])(
    'rejects non-http(s) scheme %s',
    (url) => {
      expect(() => assertProbeUrlAllowed(url)).toThrow(SsrfBlockedError);
    },
  );

  it('accepts http and https public hosts (URL-shape only)', () => {
    expect(() => assertProbeUrlAllowed('http://example.com')).not.toThrow();
    expect(() => assertProbeUrlAllowed('https://api.example.com/health')).not.toThrow();
  });

  it('rejects a non-URL string', () => {
    expect(() => assertProbeUrlAllowed('not a url')).toThrow(SsrfBlockedError);
  });
});

describe('assertProbeUrlAllowed — credentialed URLs', () => {
  it.each([
    'http://user:pass@example.com',
    'https://admin:secret@internal.example.com',
    'http://user@example.com',
  ])('rejects credentialed URL %s', (url) => {
    expect(() => assertProbeUrlAllowed(url)).toThrow(/credentialed/);
  });
});

describe('assertProbeUrlAllowed — literal-IP hosts (no DNS)', () => {
  it('rejects localhost via 127.0.0.1', () => {
    expect(() => assertProbeUrlAllowed('http://127.0.0.1')).toThrow(/127\.0\.0\.0\/8/);
  });

  it('rejects 127.0.0.1 on any port', () => {
    expect(() => assertProbeUrlAllowed('http://127.0.0.1:8080/admin')).toThrow(SsrfBlockedError);
  });

  it('rejects the cloud metadata IP 169.254.169.254', () => {
    expect(() => assertProbeUrlAllowed('http://169.254.169.254/latest/meta-data/')).toThrow(
      /169\.254\.0\.0\/16/,
    );
  });

  it.each([
    'http://10.0.0.5',
    'http://10.255.255.255',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://100.64.0.1', // CGNAT
  ])('rejects RFC1918 / CGNAT literal %s', (url) => {
    expect(() => assertProbeUrlAllowed(url)).toThrow(SsrfBlockedError);
  });

  it('rejects 0.0.0.0', () => {
    expect(() => assertProbeUrlAllowed('http://0.0.0.0')).toThrow(SsrfBlockedError);
  });

  it('rejects the broadcast / reserved 255.255.255.255', () => {
    expect(() => assertProbeUrlAllowed('http://255.255.255.255')).toThrow(SsrfBlockedError);
  });

  it('accepts a public literal IPv4 (URL-shape gate)', () => {
    expect(() => assertProbeUrlAllowed('http://1.1.1.1')).not.toThrow();
    expect(() => assertProbeUrlAllowed('https://8.8.8.8/resolve')).not.toThrow();
  });

  it('rejects the localhost hostname alias at the shape gate', () => {
    expect(() => assertProbeUrlAllowed('http://localhost')).toThrow(/loopback alias/);
    expect(() => assertProbeUrlAllowed('http://localhost:8080/admin')).toThrow(SsrfBlockedError);
  });

  it('rejects *.localhost subdomains (RFC 6761 loopback)', () => {
    expect(() => assertProbeUrlAllowed('http://api.localhost')).toThrow(SsrfBlockedError);
  });

  it('does not block public hostnames at the shape gate (DNS is the authoritative step)', () => {
    // The shape gate only blocks literal-IP internal targets; a hostname that
    // *resolves* to a private IP is caught by assertResolvedIpsAllowed at
    // probe time, not here.
    expect(() => assertProbeUrlAllowed('http://internal.corp.example')).not.toThrow();
  });
});

describe('assertProbeUrlAllowed — IPv6 literal hosts', () => {
  it('rejects IPv6 loopback ::1', () => {
    expect(() => assertProbeUrlAllowed('http://[::1]')).toThrow(/loopback/);
  });

  it('rejects IPv6 unspecified ::', () => {
    expect(() => assertProbeUrlAllowed('http://[::]')).toThrow(/unspecified/);
  });

  it('rejects ULA fc00::/7', () => {
    expect(() => assertProbeUrlAllowed('http://[fc00::1]')).toThrow(/ULA/);
    expect(() => assertProbeUrlAllowed('http://[fd12:3456::1]')).toThrow(/ULA/);
  });

  it('rejects link-local fe80::/10', () => {
    expect(() => assertProbeUrlAllowed('http://[fe80::1]')).toThrow(/link-local/);
  });

  it('rejects IPv4-mapped IPv6 pointing at the metadata IP', () => {
    expect(() => assertProbeUrlAllowed('http://[::ffff:169.254.169.254]')).toThrow(SsrfBlockedError);
  });

  it('rejects IPv4-mapped IPv6 pointing at loopback', () => {
    expect(() => assertProbeUrlAllowed('http://[::ffff:127.0.0.1]')).toThrow(SsrfBlockedError);
  });

  it('rejects IPv4-mapped IPv6 in hex form pointing at a private v4', () => {
    // ::ffff:c0a8:0101 == ::ffff:192.168.1.1
    expect(() => assertProbeUrlAllowed('http://[::ffff:c0a8:0101]')).toThrow(SsrfBlockedError);
  });
});

describe('assertResolvedIpsAllowed — the authoritative IP gate', () => {
  it('throws when the host resolved to nothing', () => {
    expect(() => { assertResolvedIpsAllowed([]); }).toThrow(/did not resolve/);
  });

  it('rejects when ANY resolved IP is private (DNS-rebinding / split-horizon)', () => {
    // A hostname that returns one public and one private record must be
    // rejected wholesale — the private one is the attack.
    expect(() => { assertResolvedIpsAllowed(['1.1.1.1', '10.0.0.5']); }).toThrow(SsrfBlockedError);
  });

  it('rejects the metadata IP among resolved records', () => {
    expect(() => { assertResolvedIpsAllowed(['169.254.169.254']); }).toThrow(SsrfBlockedError);
  });

  it('accepts an all-public resolved set', () => {
    expect(() => { assertResolvedIpsAllowed(['1.1.1.1', '8.8.8.8']); }).not.toThrow();
  });

  it('accepts a public IPv6 record', () => {
    expect(() => { assertResolvedIpsAllowed(['2606:4700:4700::1111']); }).not.toThrow();
  });

  it('rejects a malformed IP string', () => {
    expect(() => { assertResolvedIpsAllowed(['not.an.ip']); }).toThrow(SsrfBlockedError);
  });

  it('rejects a private IPv6 record (link-local) in the resolved set', () => {
    expect(() => { assertResolvedIpsAllowed(['2606:4700::1', 'fe80::1']); }).toThrow(SsrfBlockedError);
  });
});
