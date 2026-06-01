import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `bytea` column exposed as `Uint8Array` at the Drizzle boundary.
 *
 * Why a `customType` instead of a built-in primitive: drizzle-orm 0.45.x has
 * no first-class `bytea` helper under `drizzle-orm/pg-core`. The two
 * documented escape hatches are (a) `customType` and (b) `varchar` with a
 * runtime hex-encoding shim. (a) is the canonical pattern in the Drizzle
 * docs and produces real `bytea` DDL; (b) doubles wire size and loses the
 * `Uint8Array` type at the call site. We pick (a).
 *
 * Why `Uint8Array` (not `Buffer`) on both sides of the interface:
 *
 *  - `Y.encodeStateAsUpdate(doc)` returns `Uint8Array`. The Hocuspocus
 *    `Storage` adapter ADR-002 named will be the only writer/reader on
 *    this column. Threading `Uint8Array` end-to-end avoids the
 *    `Uint8Array <-> Buffer` coercion AGENT_NOTES.md flagged as a pin.
 *  - `postgres` (postgres-js) driver natively returns `Uint8Array` for
 *    `bytea` reads as of 3.4.x; passing `Uint8Array` on writes is also
 *    natively supported. No `Buffer.from(...)` round-trip required.
 *  - If a future driver upgrade or Drizzle version flips this back to
 *    `Buffer`, the coercion lives ONLY inside this file — the schema
 *    files and the Storage adapter keep their `Uint8Array` types and
 *    nothing else has to change.
 *
 * Driver / Drizzle coupling pin (ADR-003 historical note): tape committed
 * `drizzle-orm@0.45.2` + `postgres@3.4.9` (see tape/server/package.json),
 * and Drizzle 0.45 + postgres-js 3.4 exposes `bytea` as `Uint8Array`
 * natively. ADR-003 cited an older Drizzle 0.30.x quirk (`bytea` returned
 * as `Buffer`); that quirk does NOT apply at the versions meld ships on.
 * The historical pin remains in AGENT_NOTES.md because (a) it documents
 * why this `customType` exists rather than a built-in helper and (b) any
 * future downgrade reintroduces the coercion at THIS file, not at every
 * call site. Do NOT delete the AGENT_NOTES.md pin under a "remove dead
 * comment" review.
 */
export const bytea = customType<{
  data: Uint8Array;
  driverData: Uint8Array;
  notNull: false;
  default: false;
}>({
  dataType() {
    return 'bytea';
  },
});
