/**
 * Bridge codec — MessagePack encode / decode for the Rust ↔ Bun wire.
 *
 * Wraps `msgpackr` with the project-wide `useRecords: false` setting
 * (see AGENT_NOTES "msgpackr footgun" / ADR-003 § Consequences). The
 * records optimisation is non-standard MessagePack and the Rust
 * `rmp-serde` decoder will not parse it — flipping that flag on for the
 * encode-speed win silently breaks the worker. The single shared Packr /
 * Unpackr pair below keeps the configuration in one place.
 *
 * Type-erased on purpose: callers assert the payload type. Per-message
 * Zod / structural validation belongs to the consumer in Task 1.4a
 * (bridge transport, where the framing reader hands a decoded payload
 * to a typed dispatch table) and to the conformance test in Task 1.5b
 * (which round-trips fixtures against the Rust side). Wrapping that
 * validation here would penalise every frame on the hot path even when
 * the caller already knows the shape.
 */

import { Packr, Unpackr } from 'msgpackr';

const packr = new Packr({ useRecords: false });
const unpackr = new Unpackr({ useRecords: false });

/**
 * Serialize `value` to a MessagePack-encoded byte buffer.
 *
 * The returned buffer is suitable for handing to the length-prefixed
 * framing writer (Task 1.4a). msgpackr returns a Node `Buffer` which is
 * a `Uint8Array` subclass — typed as `Uint8Array` here so consumers
 * never reach for Buffer-only methods.
 */
export function encode(value: unknown): Uint8Array {
  return packr.pack(value);
}

/**
 * Decode a MessagePack-encoded byte buffer to `T`.
 *
 * Caller asserts the payload type — the generic is an ergonomic alias
 * for a return-side cast, not a type guarantee. Per ADR-003 the trust
 * boundary is at the Elysia process edge (where Zod still runs on the
 * public WS frames) and at the conformance test (Task 1.5b) which
 * round-trips fixtures against the Rust side; the bridge itself does
 * not double-validate every frame on the hot path. The
 * `no-unnecessary-type-parameters` disable below is deliberate — see
 * the function doc and ADR-003 § Consequences.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function decode<T>(buf: Uint8Array): T {
  return unpackr.unpack(buf) as T;
}
