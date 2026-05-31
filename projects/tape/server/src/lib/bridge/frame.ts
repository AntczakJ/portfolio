/**
 * Length-prefixed binary framing — Task 1.4a per ADR-002.
 *
 * Wire format (matches the Rust side in
 * `projects/tape/worker/src/bridge/transport.rs`):
 *
 *   ┌──────────────────────┬────────────────────┐
 *   │ u32 LE length (4 B)  │ payload (`length`) │
 *   └──────────────────────┴────────────────────┘
 *
 * The payload is opaque to this layer — typically MessagePack from the
 * codec wrapper in `./codec.ts`. Framing knows nothing about it.
 *
 * `FrameReader` accumulates bytes across `feed()` calls and yields one
 * decoded payload buffer per complete frame via the `frames()` generator.
 * Partial frame state never escapes — a half-written length prefix or a
 * half-written payload stays in the internal buffer until the rest
 * arrives. Throws on oversized frames so a desync (length header read
 * out of a payload by mistake) surfaces as a loud failure rather than
 * a silent memory blow-up.
 */

import { BRIDGE_MAX_FRAME_BYTES } from './config';

const LENGTH_PREFIX_BYTES = 4;

/**
 * Build one wire frame for `payload`.
 *
 * Allocates a fresh buffer (length-prefix + payload) so the caller can
 * hand the returned `Uint8Array` straight to `socket.write()` without
 * worrying about lifetime — there is no shared backing buffer to
 * accidentally mutate.
 */
export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.byteLength > BRIDGE_MAX_FRAME_BYTES) {
    throw new Error(
      `bridge frame too large to encode: ${String(payload.byteLength)} bytes > ${String(BRIDGE_MAX_FRAME_BYTES)} cap`,
    );
  }
  const out = new Uint8Array(LENGTH_PREFIX_BYTES + payload.byteLength);
  const view = new DataView(out.buffer, out.byteOffset, LENGTH_PREFIX_BYTES);
  view.setUint32(0, payload.byteLength, true);
  out.set(payload, LENGTH_PREFIX_BYTES);
  return out;
}

export interface FrameReaderOptions {
  /**
   * Hard cap on a single decoded frame. Defaults to
   * `BRIDGE_MAX_FRAME_BYTES` (1 MiB) — anything larger is treated as a
   * desync and the next `frames()` call throws.
   */
  maxFrameBytes?: number;
}

/**
 * Push bytes in via `feed()`; pull decoded payloads out via `frames()`.
 *
 * Internal state model: a single growing buffer plus a write offset.
 * Each `frames()` call reads as many whole frames as it can from the
 * head of the buffer, then compacts the buffer (drops consumed bytes,
 * shifts the tail to the front) at the end so partial-frame remnants
 * stay at index 0. We do not allocate per-feed; the buffer is reused
 * across feeds and only grows when a single frame plus its length
 * prefix exceeds the current capacity.
 */
export class FrameReader {
  readonly #maxFrameBytes: number;
  #buffer: Uint8Array;
  #written = 0;

  constructor(options: FrameReaderOptions = {}) {
    this.#maxFrameBytes = options.maxFrameBytes ?? BRIDGE_MAX_FRAME_BYTES;
    // Initial 16 KiB is comfortably above one tick frame and below the
    // default cell snapshot — grows on demand for larger payloads.
    this.#buffer = new Uint8Array(16 * 1024);
  }

  /**
   * Append `chunk` to the internal buffer. The chunk may carry any
   * fragment of the stream — zero, partial, exactly one, or many
   * frames; the reader handles all four shapes uniformly.
   */
  feed(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.#ensureCapacity(this.#written + chunk.byteLength);
    this.#buffer.set(chunk, this.#written);
    this.#written += chunk.byteLength;
  }

  /**
   * Yield each complete payload buffer currently sitting in the buffer,
   * then compact what remains. Each yielded buffer is a fresh `Uint8Array`
   * — the consumer owns it, the reader never reaches back into it.
   *
   * Throws on a frame whose declared length exceeds `maxFrameBytes`: a
   * desync at that point would otherwise allocate or read pathologically
   * large windows. The connection should be closed and re-established.
   */
  *frames(): IterableIterator<Uint8Array> {
    let cursor = 0;
    while (this.#written - cursor >= LENGTH_PREFIX_BYTES) {
      const view = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset + cursor,
        LENGTH_PREFIX_BYTES,
      );
      const length = view.getUint32(0, true);
      if (length > this.#maxFrameBytes) {
        throw new Error(
          `bridge frame too large: ${String(length)} bytes > ${String(this.#maxFrameBytes)} cap (likely desync)`,
        );
      }
      const frameEnd = cursor + LENGTH_PREFIX_BYTES + length;
      if (frameEnd > this.#written) {
        // Length prefix is here but the payload is still in flight.
        break;
      }
      // Copy out so the consumer's buffer is independent of the reader's
      // internal one (which we will overwrite on the next feed / compact).
      const payload = this.#buffer.slice(cursor + LENGTH_PREFIX_BYTES, frameEnd);
      cursor = frameEnd;
      yield payload;
    }
    if (cursor > 0) {
      this.#compact(cursor);
    }
  }

  /**
   * Number of bytes currently held in the partial-frame buffer.
   * Exposed for tests and diagnostics; not used on the hot path.
   */
  get pendingBytes(): number {
    return this.#written;
  }

  #compact(consumed: number): void {
    const remaining = this.#written - consumed;
    if (remaining > 0) {
      this.#buffer.copyWithin(0, consumed, this.#written);
    }
    this.#written = remaining;
  }

  #ensureCapacity(required: number): void {
    if (required <= this.#buffer.byteLength) return;
    let nextCapacity = this.#buffer.byteLength;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    if (nextCapacity > this.#maxFrameBytes + LENGTH_PREFIX_BYTES) {
      // Cap growth at one max-sized frame plus its header. Anything
      // beyond that is the same desync condition `frames()` throws on,
      // surfaced one step earlier so we do not over-allocate.
      throw new Error(
        `bridge reader buffer growth exceeded cap: ${String(required)} bytes > ${String(this.#maxFrameBytes)} + header`,
      );
    }
    const grown = new Uint8Array(nextCapacity);
    grown.set(this.#buffer.subarray(0, this.#written));
    this.#buffer = grown;
  }
}
