/**
 * Bridge endpoint path resolution — Task 1.4a per ADR-002.
 *
 * ADR-002 pins the transport as Unix domain socket on Linux / macOS and
 * named pipe on Windows. Both shapes are reachable from Bun via
 * `Bun.connect({ unix: path })` — Bun accepts either form on its
 * respective OS. The runtime abstraction here is intentionally tiny:
 * the path is just a string, the only branching is at the platform
 * boundary and at the `BRIDGE_PATH` override.
 */

/**
 * Resolve the bridge endpoint path.
 *
 *  1. `BRIDGE_PATH` env var wins when set. Production containers pin a
 *     fixed UDS path (e.g. `/run/tape/bridge.sock`) via env so the
 *     worker spawn and the Elysia connect agree without hard-coding.
 *  2. Linux / macOS default: `/tmp/tape-bridge.sock`.
 *  3. Windows default: `\\.\pipe\tape-bridge`.
 *
 * There is no in-process default for an unknown platform — Bun ships on
 * the three platforms above and a future port should make a deliberate
 * decision rather than inherit Linux's choice silently.
 */
export function defaultBridgePath(): string {
  const override = process.env.BRIDGE_PATH;
  if (override && override.length > 0) {
    return normalizeBridgePath(override);
  }
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\tape-bridge';
  }
  return '/tmp/tape-bridge.sock';
}

/**
 * Repair a Windows named-pipe path whose leading `\\` was collapsed to
 * a single `\`.
 *
 * **Why this exists.** `Bun.spawn` on Windows collapses every `\\` in an
 * inherited env value to a single `\` when handing it to a child
 * process — so a `BRIDGE_PATH=\\.\pipe\tape-bridge` set in the parent is
 * read back as `\.\pipe\tape-bridge` by the spawned Rust worker, and the
 * `interprocess` crate then rejects it as "not a named pipe path". The
 * Rust side has the canonical repair (`bridge/transport.rs ::
 * normalize_bridge_path`); this TS mirror covers the symmetric case
 * where the PARENT itself was handed a collapsed value (e.g. a hand-
 * edited `.env` with a single-backslash pipe path) so the bridge client
 * still connects to the canonical `\\.\pipe\` form the worker binds.
 *
 * A local Windows pipe path is always `\\.\pipe\<name>`. Already-
 * canonical paths and POSIX UDS paths pass through untouched, so this is
 * a no-op on Linux and on correctly-formed input.
 */
export function normalizeBridgePath(path: string): string {
  // Already canonical (`\\.\pipe\...` / `\\host\pipe\...`) — leave it.
  if (path.startsWith('\\\\')) return path;
  // Collapsed local-pipe form: `\.\pipe\name` → `\\.\pipe\name`.
  if (path.startsWith('\\.\\pipe\\')) {
    return `\\\\${path.slice(1)}`;
  }
  // Further-collapsed / host-form: `.\pipe\name` → `\\.\pipe\name`.
  if (path.startsWith('.\\pipe\\')) {
    return `\\\\.${path.slice(1)}`;
  }
  return path;
}

/**
 * `true` when `path` points at a Windows named pipe.
 *
 * Named-pipe and UDS clients share the `Bun.connect({ unix })` surface
 * but differ on a few lifecycle details — chiefly that named-pipe
 * close semantics on Windows do not produce an EPIPE in the same way
 * a UDS does. Consumers that care (the supervisor's stdout drain, the
 * reconnect classifier) read this flag rather than re-test the prefix.
 */
export function isPipe(path: string): boolean {
  return path.startsWith('\\\\.\\pipe\\');
}
