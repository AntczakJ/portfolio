/**
 * Bridge conformance test — Task 1.5b per ADR-003.
 *
 * Locks the Rust ↔ Bun frame contract at the byte level by exercising
 * the committed MessagePack fixture set against both halves of the
 * codec at once. Each fixture variant ships two committed byte
 * oracles:
 *
 *   - `<name>.msgpack`         — canonical rmp-serde-encoded bytes,
 *                                emitted by the Rust binary
 *                                `gen-fixtures` (see PROGRESS.md /
 *                                README.md `Bridge schema workflow`).
 *                                This is the byte the Rust worker
 *                                writes on the live bridge.
 *   - `<name>.from-ts.msgpack` — canonical msgpackr-encoded bytes,
 *                                emitted by this test suite via the
 *                                `bridge:gen-fixtures` script when
 *                                run with `BRIDGE_GEN_FROM_TS=1`.
 *                                This is the byte the Elysia control
 *                                plane writes on the live bridge.
 *
 * Both files decode to the same logical value on both sides — that
 * is the bidirectional contract the bridge actually depends on. The
 * byte representations DIFFER between rmp-serde and msgpackr because
 * the two encoders pick different spec-valid forms for the same
 * value:
 *
 *   - msgpackr always emits `map16` (`de` prefix, 3-byte header)
 *     even for sub-16-element maps; rmp-serde emits fixmap (`8x`
 *     prefix, 1-byte header) for maps with ≤ 15 elements.
 *   - msgpackr always emits BigInt as int64 (`d3`, 9 bytes);
 *     rmp-serde picks the smallest int container that fits (positive
 *     fixint for 0..127, uint8 / uint16 / uint32 / uint64 / int8 /
 *     int16 / int32 / int64 otherwise).
 *
 * Both choices are MessagePack-spec-conformant; both decoders
 * accept both shapes. That is the property the conformance test
 * locks. The single-direction byte determinism (rmp-serde encoded
 * value always equals `<name>.msgpack`) is locked by the matching
 * Rust integration test in `../../tape-worker/tests/conformance.rs`.
 *
 * Test runner: `bun test` (Bun's built-in test runner, wired through
 * `tape-server`'s `test` script in package.json). NOT vitest — the
 * server is Bun-native and bun:test is the canonical Bun stdlib test
 * runner; vitest doesn't run on Bun's runtime by default.
 *
 * Regenerating the fixtures (dev-time only, NEVER in CI):
 *   cd projects/tape/worker && cargo run --bin gen-fixtures
 *   # to refresh .msgpack (rmp-serde oracle), THEN:
 *   BRIDGE_GEN_FROM_TS=1 bun test src/lib/bridge/__tests__/conformance.test.ts
 *   # to refresh .from-ts.msgpack (msgpackr oracle).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode, encode } from '../codec';
import { encodeFrame, FrameReader } from '../frame';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(here, '..', '..', 'schemas', 'bridge', 'fixtures');

const REGENERATE_FROM_TS = process.env.BRIDGE_GEN_FROM_TS === '1';

type FixtureSchema =
  | 'TickFrame'
  | 'CellSnapshot'
  | 'ControlCommand'
  | 'CellDelta'
  | 'CellClose'
  | 'SnapshotPayload'
  | 'WorkerReady'
  | 'WorkerUnavailable';

interface FixtureFile {
  readonly _doc: string;
  readonly schema: FixtureSchema;
  /**
   * Logical value as a plain JSON object. Keys are listed in the exact
   * Rust struct field order — that order is load-bearing because
   * msgpackr serialises object properties in insertion order and
   * rmp-serde serialises struct fields in declaration order. JSON.parse
   * preserves key order on every standards-compliant runtime (ES2020+).
   */
  readonly value: Readonly<Record<string, unknown>>;
  /**
   * Names of fields inside `value` whose wire type is a MessagePack
   * int64 family value (Rust `i64`). The test coerces these to
   * `bigint` before encoding and tolerates either `bigint` or `number`
   * when comparing decoded output (msgpackr returns the int64 family
   * as `bigint` by default — see AGENT_NOTES "ts-rs maps Rust `i64`
   * → TypeScript `bigint`").
   *
   * For Task 1.5 nested fixtures (e.g. `SnapshotPayload.cells_open[*]`)
   * the path uses dot notation with `*` for "every index" and `N` for
   * "index N": `cells_open.*.bucket_ts` matches `value.cells_open[0].bucket_ts`,
   * `value.cells_open[1].bucket_ts`, etc. The path resolver is
   * intentionally restricted to these two segment kinds so a typo
   * surfaces as "no match" rather than "any path resolves".
   */
  readonly bigintFields: readonly string[];
}

function loadFixture(name: string): {
  file: FixtureFile;
  rustBytes: Uint8Array;
  tsBytes: Uint8Array;
} {
  const jsonPath = resolve(FIXTURES_DIR, `${name}.json`);
  const file = JSON.parse(readFileSync(jsonPath, 'utf8')) as FixtureFile;
  const rustBuf = readFileSync(resolve(FIXTURES_DIR, `${name}.msgpack`));
  // Under BRIDGE_GEN_FROM_TS the from-ts file may not yet exist (we
  // are about to write it for the first time). Tolerate the miss by
  // returning an empty Uint8Array — the encode-byte-match test below
  // overwrites it before asserting byteLength, so the placeholder is
  // never actually compared against. Outside regen mode a missing
  // file is a fixture-tree corruption — let the readFileSync throw.
  let tsBytes: Uint8Array;
  const tsPath = resolve(FIXTURES_DIR, `${name}.from-ts.msgpack`);
  try {
    const tsBuf = readFileSync(tsPath);
    tsBytes = new Uint8Array(tsBuf.buffer, tsBuf.byteOffset, tsBuf.byteLength);
  } catch (err) {
    if (!REGENERATE_FROM_TS) throw err;
    tsBytes = new Uint8Array(0);
  }
  return {
    file,
    rustBytes: new Uint8Array(
      rustBuf.buffer,
      rustBuf.byteOffset,
      rustBuf.byteLength,
    ),
    tsBytes,
  };
}

/**
 * Returns true if `pathToCheck` (in segment form) matches one of the
 * bigint-field patterns in `paths`. A pattern uses `.` to separate
 * segments and may carry `*` as a wildcard for "any array index". The
 * concrete path the caller is asking about has integers in those slots.
 *
 * Example: `cells_open.*.bucket_ts` matches `cells_open.0.bucket_ts`
 * and `cells_open.7.bucket_ts`.
 */
function matchesBigintPath(
  paths: readonly string[],
  pathToCheck: readonly string[],
): boolean {
  for (const pattern of paths) {
    const segs = pattern.split('.');
    if (segs.length !== pathToCheck.length) continue;
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const want = segs[i];
      const got = pathToCheck[i];
      if (want === '*') continue;
      if (want !== got) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Recursively coerce `value` to the shape the msgpackr encoder expects:
 * any leaf at a path matching `file.bigintFields` becomes a `BigInt`,
 * everything else passes through unchanged. Object key order is
 * preserved from `Object.entries` (which preserves JSON.parse order on
 * ES2020+), so the resulting encode matches the wire byte order rmp-serde
 * pinned.
 */
function materialiseValue(
  value: unknown,
  bigintFields: readonly string[],
  path: readonly string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      materialiseValue(item, bigintFields, [...path, String(idx)]),
    );
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = materialiseValue(raw, bigintFields, [...path, key]);
    }
    return out;
  }
  if (matchesBigintPath(bigintFields, path)) {
    return BigInt(value as string | number);
  }
  return value;
}

function materialise(file: FixtureFile): Record<string, unknown> {
  return materialiseValue(file.value, file.bigintFields, []) as Record<
    string,
    unknown
  >;
}

/**
 * Recursive structural compare. Honours the bigint coercion at every
 * matching leaf path; msgpackr decodes bigint-as-int64 to `bigint`, but
 * a future major could lower small int64s to `number` — we tolerate
 * either by coercing both sides to `BigInt` before comparing.
 */
function assertValueMatches(
  got: unknown,
  want: unknown,
  bigintFields: readonly string[],
  path: readonly string[],
): void {
  if (Array.isArray(want)) {
    expect(Array.isArray(got)).toBe(true);
    const gotArr = got as unknown[];
    expect(gotArr.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) {
      assertValueMatches(gotArr[i], want[i], bigintFields, [
        ...path,
        String(i),
      ]);
    }
    return;
  }
  if (want !== null && typeof want === 'object') {
    expect(typeof got).toBe('object');
    expect(got).not.toBeNull();
    const gotObj = got as Record<string, unknown>;
    const wantObj = want as Record<string, unknown>;
    expect(Object.keys(gotObj).sort()).toEqual(Object.keys(wantObj).sort());
    for (const key of Object.keys(wantObj)) {
      assertValueMatches(gotObj[key], wantObj[key], bigintFields, [
        ...path,
        key,
      ]);
    }
    return;
  }
  if (matchesBigintPath(bigintFields, path)) {
    const wantBig =
      typeof want === 'bigint' ? want : BigInt(want as string | number);
    const gotBig =
      typeof got === 'bigint' ? got : BigInt(got as string | number);
    expect(gotBig).toBe(wantBig);
    return;
  }
  expect(got).toEqual(want);
}

function assertDecodedMatches(decoded: unknown, file: FixtureFile): void {
  expect(decoded).toBeTypeOf('object');
  expect(decoded).not.toBeNull();
  const want = materialise(file);
  assertValueMatches(decoded, want, file.bigintFields, []);
}

const FIXTURE_NAMES = [
  'tick.min',
  'tick.typical',
  'cell.min',
  'cell.peak',
  'control.pause',
  'control.snapshot',
  // Task 1.5 outbound shapes.
  'cell.delta.typical',
  'cell.close.typical',
  'snapshot.typical',
  'worker.ready',
  'worker.unavailable',
] as const;

describe('bridge conformance — payload round-trip per ADR-003', () => {
  for (const name of FIXTURE_NAMES) {
    describe(name, () => {
      test('decodes the canonical rmp-serde-authored .msgpack to the JSON source', () => {
        // Proves the Bun control plane can read what the Rust worker
        // writes on the live bridge. The Rust worker's wire bytes are
        // what `<name>.msgpack` holds.
        const { file, rustBytes } = loadFixture(name);
        const decoded = decode<Record<string, unknown>>(rustBytes);
        assertDecodedMatches(decoded, file);
      });

      test('decodes the canonical msgpackr-authored .from-ts.msgpack to the JSON source', () => {
        // Proves the codec is self-consistent against its own
        // captured oracle — guards against a future msgpackr major
        // changing the decode shape without us noticing.
        const { file, tsBytes } = loadFixture(name);
        const decoded = decode<Record<string, unknown>>(tsBytes);
        assertDecodedMatches(decoded, file);
      });

      test('msgpackr encode is byte-for-byte identical to .from-ts.msgpack', () => {
        // Locks msgpackr determinism: the same logical value always
        // encodes to the same bytes on this side. A diff here means
        // either the JSON source drifted without regenerating the
        // from-ts oracle (run `BRIDGE_GEN_FROM_TS=1 bun test ...`)
        // or msgpackr's encoder picked a different in-spec form.
        // INVESTIGATE before regenerating — silent regeneration is
        // exactly the contract bug the conformance test exists to
        // catch.
        const { file } = loadFixture(name);
        const value = materialise(file);
        const encoded = encode(value);

        if (REGENERATE_FROM_TS) {
          const target = resolve(FIXTURES_DIR, `${name}.from-ts.msgpack`);
          writeFileSync(target, encoded);
          console.log(
            `[regen] ${target} ← ${String(encoded.byteLength)} bytes`,
          );
        }

        // Re-read after potential regen so a fresh from-ts file is
        // compared against the encoded bytes we just wrote (in regen
        // mode the comparison is trivially true; outside regen mode
        // the committed oracle is the contract).
        const { tsBytes } = loadFixture(name);
        expect(encoded.byteLength).toBe(tsBytes.byteLength);
        expect(Array.from(encoded)).toEqual(Array.from(tsBytes));
      });

      test('msgpackr round-trips the value through encode + decode', () => {
        // Self-consistency check on the Bun side — encode and
        // immediately decode the canonical value, assert structural
        // identity. Catches a class of msgpackr bugs (Packr vs
        // Unpackr config drift) that would not surface in the
        // single-direction decode test.
        const { file } = loadFixture(name);
        const value = materialise(file);
        const round = decode<Record<string, unknown>>(encode(value));
        assertDecodedMatches(round, file);
      });
    });
  }
});

describe('bridge conformance — framing round-trip (payload-agnostic)', () => {
  test('encodeFrame writes a u32-LE length prefix followed by the payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const framed = encodeFrame(payload);
    expect(framed.byteLength).toBe(4 + payload.byteLength);
    const view = new DataView(
      framed.buffer,
      framed.byteOffset,
      framed.byteLength,
    );
    expect(view.getUint32(0, true)).toBe(payload.byteLength);
    expect(Array.from(framed.slice(4))).toEqual(Array.from(payload));
  });

  test('FrameReader.feed + frames() recovers every payload across arbitrary chunking', () => {
    const payloads = [
      new Uint8Array([0xaa]),
      new Uint8Array([0xbb, 0xcc, 0xdd]),
      new Uint8Array(64).fill(0xee),
      new Uint8Array([0xff]),
    ];
    const wire = new Uint8Array(
      payloads.reduce((acc, p) => acc + 4 + p.byteLength, 0),
    );
    let offset = 0;
    for (const p of payloads) {
      const framed = encodeFrame(p);
      wire.set(framed, offset);
      offset += framed.byteLength;
    }

    // 1-byte feeds force partial frames and length-prefix splits
    // across calls — the FrameReader must tolerate every shape.
    const reader = new FrameReader();
    const recovered: Uint8Array[] = [];
    for (let i = 0; i < wire.byteLength; i++) {
      reader.feed(wire.slice(i, i + 1));
      for (const frame of reader.frames()) {
        recovered.push(frame);
      }
    }
    expect(recovered.length).toBe(payloads.length);
    for (let i = 0; i < payloads.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(Array.from(recovered[i]!)).toEqual(Array.from(payloads[i]!));
    }
    expect(reader.pendingBytes).toBe(0);
  });

  test('round-trips every fixture through encodeFrame + FrameReader', () => {
    const reader = new FrameReader();
    const expectedPayloads: Uint8Array[] = [];
    for (const name of FIXTURE_NAMES) {
      const { rustBytes } = loadFixture(name);
      expectedPayloads.push(rustBytes);
      reader.feed(encodeFrame(rustBytes));
    }
    const recovered = Array.from(reader.frames());
    expect(recovered.length).toBe(expectedPayloads.length);
    for (let i = 0; i < expectedPayloads.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(Array.from(recovered[i]!)).toEqual(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        Array.from(expectedPayloads[i]!),
      );
    }
    expect(reader.pendingBytes).toBe(0);
  });
});
