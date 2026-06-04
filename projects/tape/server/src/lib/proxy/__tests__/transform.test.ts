import { describe, expect, test } from 'bun:test';

import {
  stripHopByHopRequestHeaders,
  stripTransportEncodingResponseHeaders,
} from '../transform';

describe('stripTransportEncodingResponseHeaders (P0-1)', () => {
  test('drops content-encoding, content-length, transfer-encoding', () => {
    const upstream = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
      'content-length': '1234',
      'transfer-encoding': 'chunked',
      etag: 'W/"abc"',
    });

    const out = stripTransportEncodingResponseHeaders(upstream);

    // The three transport/encoding headers are gone — the browser must
    // not try to decompress a body Bun's fetch already decompressed.
    expect(out.has('content-encoding')).toBe(false);
    expect(out.has('content-length')).toBe(false);
    expect(out.has('transfer-encoding')).toBe(false);
    // Everything else is preserved untouched.
    expect(out.get('content-type')).toBe('text/html; charset=utf-8');
    expect(out.get('etag')).toBe('W/"abc"');
  });

  test('is case-insensitive on header names (Headers normalises)', () => {
    const upstream = new Headers();
    upstream.set('Content-Encoding', 'br');
    upstream.set('Content-Length', '99');

    const out = stripTransportEncodingResponseHeaders(upstream);

    expect(out.has('content-encoding')).toBe(false);
    expect(out.has('content-length')).toBe(false);
  });

  test('does not mutate the source Headers', () => {
    const upstream = new Headers({ 'content-encoding': 'gzip' });

    stripTransportEncodingResponseHeaders(upstream);

    expect(upstream.get('content-encoding')).toBe('gzip');
  });

  test('is a no-op when none of the headers are present', () => {
    const upstream = new Headers({ 'content-type': 'application/json' });

    const out = stripTransportEncodingResponseHeaders(upstream);

    expect(out.get('content-type')).toBe('application/json');
    expect([...out.keys()]).toEqual(['content-type']);
  });
});

describe('stripHopByHopRequestHeaders (P0-1)', () => {
  test('drops host and connection from forwarded request headers', () => {
    const incoming = new Headers({
      host: 'tape-demo.fly.dev',
      connection: 'keep-alive',
      'user-agent': 'curl/8.0',
      accept: '*/*',
    });

    const out = stripHopByHopRequestHeaders(incoming);

    // The external edge host must not be relayed to 127.0.0.1:3000, and
    // the per-hop `connection` control header must not cross the proxy.
    expect(out.has('host')).toBe(false);
    expect(out.has('connection')).toBe(false);
    // App-level headers survive so the upstream still sees the client.
    expect(out.get('user-agent')).toBe('curl/8.0');
    expect(out.get('accept')).toBe('*/*');
  });

  test('does not mutate the source Headers', () => {
    const incoming = new Headers({ host: 'tape-demo.fly.dev' });

    stripHopByHopRequestHeaders(incoming);

    expect(incoming.get('host')).toBe('tape-demo.fly.dev');
  });
});
