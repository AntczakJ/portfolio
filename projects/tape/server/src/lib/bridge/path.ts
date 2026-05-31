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
    return override;
  }
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\tape-bridge';
  }
  return '/tmp/tape-bridge.sock';
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
