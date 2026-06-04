/**
 * NDJSON streaming helper — Task 1.7.
 *
 * Turns an async generator of validated rows into a
 * `ReadableStream<Uint8Array>` of newline-delimited JSON. Extracted from
 * `route.ts` so the streaming + per-line-validation + ordering + empty-
 * stream behaviour is unit-testable with a fake generator, independent of
 * Postgres (the replay query path needs a real DB; the serialisation path
 * does not, and is the part most likely to regress on a refactor).
 *
 * **Backpressure.** Each row is produced lazily inside `pull` — the
 * generator only advances when the consumer pulls, so the underlying
 * postgres-js cursor stays in lockstep with the reader and memory stays
 * flat at one row regardless of day size (ADR-005 § "must stream, not
 * buffer-then-send").
 *
 * **Per-line validation at the boundary.** `parse` runs before
 * serialisation (the route passes `replayCellRowSchema.parse` /
 * `replayTickRowSchema.parse`) so a query refactor that breaks the row
 * shape throws here rather than shipping a malformed line — correctness at
 * the boundary per docs/conventions.md § 5.
 *
 * **Error propagation.** A mid-stream error (DB drop, or a row that fails
 * validation) is surfaced via `controller.error(...)`: the body
 * terminates abnormally rather than silently truncating with a clean
 * 200-looking close. Headers (200) were already sent when streaming
 * began, so the abnormal termination — a truncated final line — is the
 * client's signal.
 */

const TEXT_ENCODER = new TextEncoder();

export function ndjsonStream<Row>(
  rows: AsyncGenerator<Row, void, unknown>,
  parse: (row: Row) => Row,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await rows.next();
        if (next.done === true) {
          controller.close();
          return;
        }
        const validated = parse(next.value);
        controller.enqueue(
          TEXT_ENCODER.encode(`${JSON.stringify(validated)}\n`),
        );
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      // Client disconnected / aborted — let the generator clean up its
      // open postgres-js cursor (returning ends the for-await loop and
      // closes the portal).
      await rows.return();
    },
  });
}
