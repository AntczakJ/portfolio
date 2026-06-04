# Aggregator conformance fixtures

These fixtures are the **shared input → expected oracle** for the
footprint-cell aggregator. They exist so three independent consumers
assert the SAME behaviour:

1. **Task 1.4 (this package).** The TypeScript reference aggregator unit
   suite (`../__tests__/core.test.ts`) replays each `input.ticks`
   sequence through `AggregatorCore` and asserts the emitted frames + CVD
   - final snapshot/counters match the committed `expected.*`.
2. **Task 1.5 (Rust port).** `worker/src/aggregator/mod.rs` can load the
   same `*.input.json` files (plain JSON, `serde`-friendly) and assert
   its own output matches `*.expected.json` — this is the byte-identical
   conformance contract the brief pins.
3. **Task 5.2 (conformance test).** The cross-language test that runs the
   Rust port against the TS reference on a recorded dataset reuses these
   same pairs as its smaller deterministic checks alongside the recorded
   1h dataset.

## Format

Each scenario is two files sharing a basename:

- `<name>.input.json` — `{ description, ticks: AggregatorTick[], closeAt: number[] }`
  - `ticks` are fed in array order via `onTick`.
  - `closeAt` is an ordered list of `nowMs` values; after all ticks are
    fed, `closeExpired(nowMs)` is called once per entry, in order, and
    finally `drainAll()` closes anything still open.
- `<name>.expected.json` — `{ deltas, closes, cvd, finalSnapshot, counters }`
  - `deltas` — every `cell.delta` payload emitted by `onTick`, in order.
  - `closes` — every `cell.close` payload emitted by the `closeExpired`
    sweeps + the final `drainAll`, in emission order.
  - `cvd` — every `CvdRollup` emitted, in order.
  - `finalSnapshot` — `snapshot()` after `drainAll` (open map is empty,
    so `cellsOpen` is `[]` and `ticksProcessed` is the total tick count).
  - `counters` — `{ outOfOrderTicks, duplicateTicks, sessionExtreme }`
    where `sessionExtreme` is a `{ [symbol]: number }` map.

## Regeneration

The `expected.*` files are DERIVED from the `input.*` files by running
the reference core. Do not hand-edit them. Regenerate with:

```sh
bun run scripts/gen-aggregator-fixtures.ts
```

(from `projects/tape/server`). If a regeneration produces a different
`expected.*` than what is committed, that is an intentional behaviour
change — review it, mirror it in the Rust port, and commit both. If it
is NOT intentional, you introduced a regression.

## Numeric note

All volumes/prices are chosen so the floating-point sums are exact in
IEEE-754 f64 (small dyadic-rational quantities like 0.5, 0.25, 0.125,
0.1 summed a bounded number of times). This keeps the TS ↔ Rust
comparison an exact equality rather than an epsilon comparison for the
representative scenarios. The recorded 1h dataset (Task 5.2) may need an
epsilon on the volume sums; these hand-authored scenarios do not.
