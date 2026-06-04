/**
 * Replay schema barrel — single runtime + type import surface for the
 * NDJSON replay line shapes (Task 1.7 / ADR-005).
 *
 * The replay routes return a chunked NDJSON body (bytes, not an
 * Eden-Treaty-typed JSON response), so the browser replay reducer
 * (Task 3.6) parses each line itself and needs the RUNTIME Zod schema —
 * not just the type — to validate lines at the boundary. This barrel is
 * re-exported from the package via the `./replay-schemas` entry (see
 * `tape-server/package.json`), mirroring the `./ws-schemas` entry for
 * the WS frame contract. Same rationale: the WS / replay paths are
 * outside Eden Treaty's HTTP type-inference lane (ADR-006), so their
 * schemas reach `tape-web` through an explicit runtime export rather
 * than the inferred `App` type.
 */
export { replayCellRowSchema } from './cell';
export type { ReplayCellRow } from './cell';

export { replayTickRowSchema } from './tick';
export type { ReplayTickRow } from './tick';
