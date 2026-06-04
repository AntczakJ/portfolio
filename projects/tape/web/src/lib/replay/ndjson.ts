/**
 * Incremental NDJSON line parsing for the replay streams (Task 3.6).
 *
 * The replay cell endpoint (`GET /api/replay/:symbol/:date`) returns a
 * chunked `application/x-ndjson` body — one JSON object per `\n`-
 * terminated line, ~72K lines worst case (ADR-005). We MUST consume it
 * incrementally: parsing line-by-line as bytes arrive rather than
 * awaiting the whole body, so the virtual clock can start materialising
 * bars while the tail of the day is still downloading.
 *
 * `NdjsonLineBuffer` is the pure, framework-free core of that pipeline:
 * push raw decoded text chunks in, get back complete lines. It holds the
 * partial trailing line across chunk boundaries (a chunk almost never
 * ends on a `\n`). `flush()` returns any final unterminated line at end
 * of stream (servers may or may not emit a trailing newline).
 *
 * Kept transport-agnostic on purpose — it takes already-decoded strings,
 * not bytes — so the unit tests drive it directly without a fake
 * `ReadableStream` / `TextDecoder`. The streaming glue
 * (`streamNdjson`) wires it to a real `fetch` body.
 */

/**
 * Accumulates decoded text chunks and yields complete NDJSON lines.
 * Empty lines (a bare `\n`, or trailing whitespace-only fragments) are
 * skipped — they are never valid JSON objects and a tolerant stream
 * (e.g. a server that pads with a heartbeat newline) must not crash the
 * reducer.
 */
export class NdjsonLineBuffer {
  #partial = '';

  /**
   * Push one decoded text chunk. Returns every COMPLETE line the chunk
   * (combined with any held partial) produced, in order. The trailing
   * fragment after the last `\n` is held for the next push.
   */
  push(chunk: string): string[] {
    if (chunk.length === 0) return [];
    const combined = this.#partial + chunk;
    const segments = combined.split('\n');
    // The last segment is the (possibly empty) partial after the final
    // `\n` — hold it for the next chunk.
    this.#partial = segments.pop() ?? '';
    const lines: string[] = [];
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed.length > 0) lines.push(trimmed);
    }
    return lines;
  }

  /**
   * Drain the final held fragment at end of stream. Returns the last
   * line if the stream did not terminate with a `\n`, else an empty
   * array. After `flush()` the buffer is reset.
   */
  flush(): string[] {
    const trimmed = this.#partial.trim();
    this.#partial = '';
    return trimmed.length > 0 ? [trimmed] : [];
  }
}

/**
 * Parse one NDJSON line into a typed row via a validator. Returns
 * `null` on a malformed line rather than throwing, so one bad line in a
 * 72K-line stream is dropped (logged by the caller) instead of aborting
 * the whole replay. The validator is the schema's `safeParse`-style
 * guard supplied by the caller.
 */
export function parseNdjsonLine<T>(
  line: string,
  parse: (value: unknown) => { ok: true; value: T } | { ok: false },
): T | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return null;
  }
  const result = parse(decoded);
  return result.ok ? result.value : null;
}

/**
 * Stream a `fetch` Response body as NDJSON lines, invoking `onLine` for
 * each complete line as it arrives. Resolves when the body ends (after
 * flushing the final partial line). Aborts early if `signal` fires.
 *
 * The function never buffers the whole body — it reads the
 * `ReadableStream` reader chunk by chunk, decodes with a streaming
 * `TextDecoder`, and feeds an `NdjsonLineBuffer`. This is the contract
 * that keeps the wow-moment bar-by-bar materialisation responsive on a
 * multi-megabyte day.
 */
export async function streamNdjson(
  response: Response,
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = response.body;
  if (body === null) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buffer = new NdjsonLineBuffer();
  try {
    for (;;) {
      if (signal?.aborted === true) return;
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of buffer.push(text)) onLine(line);
    }
    // Flush the streaming decoder + any final unterminated line.
    const tail = decoder.decode();
    if (tail.length > 0) {
      for (const line of buffer.push(tail)) onLine(line);
    }
    for (const line of buffer.flush()) onLine(line);
  } finally {
    reader.releaseLock();
  }
}
