import { describe, expect, it } from 'vitest';

import {
  NdjsonLineBuffer,
  parseNdjsonLine,
  streamNdjson,
} from '../ndjson';

describe('NdjsonLineBuffer', () => {
  it('yields complete lines and holds the trailing partial', () => {
    const buf = new NdjsonLineBuffer();
    expect(buf.push('{"a":1}\n{"b":2}\n{"c":')).toEqual(['{"a":1}', '{"b":2}']);
    // The partial `{"c":` is held; the next chunk completes it.
    expect(buf.push('3}\n')).toEqual(['{"c":3}']);
    expect(buf.flush()).toEqual([]);
  });

  it('reassembles a line split across many chunks', () => {
    const buf = new NdjsonLineBuffer();
    expect(buf.push('{"sy')).toEqual([]);
    expect(buf.push('mbol":"B')).toEqual([]);
    expect(buf.push('TC"}\n')).toEqual(['{"symbol":"BTC"}']);
  });

  it('skips empty / whitespace-only lines', () => {
    const buf = new NdjsonLineBuffer();
    expect(buf.push('\n\n  \n{"a":1}\n')).toEqual(['{"a":1}']);
  });

  it('flush returns a final unterminated line', () => {
    const buf = new NdjsonLineBuffer();
    expect(buf.push('{"a":1}\n{"b":2}')).toEqual(['{"a":1}']);
    expect(buf.flush()).toEqual(['{"b":2}']);
    // Buffer is reset after flush.
    expect(buf.flush()).toEqual([]);
  });

  it('treats a CRLF body as lines too (trim drops the \\r)', () => {
    const buf = new NdjsonLineBuffer();
    expect(buf.push('{"a":1}\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });
});

interface Row {
  n: number;
}

function parseRow(value: unknown): { ok: true; value: Row } | { ok: false } {
  if (
    typeof value === 'object' &&
    value !== null &&
    'n' in value &&
    typeof (value as { n: unknown }).n === 'number'
  ) {
    return { ok: true, value: { n: (value as { n: number }).n } };
  }
  return { ok: false };
}

describe('parseNdjsonLine', () => {
  it('parses a valid line through the validator', () => {
    expect(parseNdjsonLine('{"n":42}', parseRow)).toEqual({ n: 42 });
  });

  it('returns null on malformed JSON', () => {
    expect(parseNdjsonLine('{"n":', parseRow)).toBeNull();
  });

  it('returns null when the validator rejects', () => {
    expect(parseNdjsonLine('{"n":"x"}', parseRow)).toBeNull();
  });
});

/** Build a minimal Response-like with a ReadableStream body of UTF-8 chunks. */
function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

describe('streamNdjson', () => {
  it('emits each complete line as chunks arrive, incrementally', async () => {
    const lines: string[] = [];
    await streamNdjson(
      ndjsonResponse(['{"a":1}\n{"b":', '2}\n{"c":3}\n']),
      (line) => lines.push(line),
    );
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('flushes a body without a trailing newline', async () => {
    const lines: string[] = [];
    await streamNdjson(ndjsonResponse(['{"a":1}\n{"b":2}']), (line) =>
      lines.push(line),
    );
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('produces nothing for an empty body (empty replay day)', async () => {
    const lines: string[] = [];
    await streamNdjson(ndjsonResponse([]), (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it('stops early when the abort signal is already fired', async () => {
    const lines: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await streamNdjson(
      ndjsonResponse(['{"a":1}\n']),
      (line) => lines.push(line),
      controller.signal,
    );
    expect(lines).toEqual([]);
  });
});
