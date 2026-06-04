/**
 * Aggregator conformance fixture generator — Task 1.4.
 *
 * Derives the `*.expected.json` oracle from each committed
 * `*.input.json` by replaying the input through the REFERENCE
 * `AggregatorCore`. The replay procedure encoded here is canonical: the
 * Rust port (Task 1.5) and the conformance test (Task 5.2) must drive
 * their aggregator the same way to compare against the same expected
 * output.
 *
 * Replay procedure (the contract):
 *   1. Feed every `input.ticks[i]` through `onTick`, in array order,
 *      collecting every emitted `cell.delta` payload.
 *   2. For each `input.closeAt[j]` in order, call `closeExpired(nowMs)`,
 *      collecting `cell.close` payloads and `CvdRollup`s.
 *   3. Call `drainAll()` once at the end, collecting the remaining
 *      `cell.close` payloads and `CvdRollup`s.
 *   4. Read `snapshot()` (now empty) and the observability counters.
 *
 * Run from `projects/tape/server`:
 *
 *   bun run scripts/gen-aggregator-fixtures.ts
 *
 * Do NOT hand-edit the `expected.*` files — regenerate. A diff after
 * regeneration is an intentional behaviour change to review and mirror
 * into the Rust port, or a regression you just introduced.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  replayFixture,
  type AggregatorInputFixture,
} from '../src/lib/aggregator/replay';

function main(): void {
  const dir = join(import.meta.dir, '..', 'src', 'lib', 'aggregator', '__fixtures__');
  const inputs = readdirSync(dir).filter((f) => f.endsWith('.input.json'));
  if (inputs.length === 0) {
    throw new Error(`no *.input.json fixtures found in ${dir}`);
  }
  for (const inputFile of inputs.sort()) {
    const base = inputFile.slice(0, -'.input.json'.length);
    const input = JSON.parse(
      readFileSync(join(dir, inputFile), 'utf8'),
    ) as AggregatorInputFixture;
    const expected = replayFixture(input);
    const outPath = join(dir, `${base}.expected.json`);
    writeFileSync(outPath, `${JSON.stringify(expected, null, 2)}\n`, 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      `wrote ${base}.expected.json — ${String(expected.deltas.length)} deltas, ${String(expected.closes.length)} closes, ${String(expected.cvd.length)} cvd rollups`,
    );
  }
}

if (import.meta.main) {
  main();
}
